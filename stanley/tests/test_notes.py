"""Tests for the Notes module."""

import pytest
import tempfile
from datetime import datetime
from pathlib import Path

from stanley.notes import (
    NoteManager,
    Vault,
    Templates,
    Note,
    NoteFrontmatter,
    ThesisFrontmatter,
    TradeFrontmatter,
    EventFrontmatter,
    PersonFrontmatter,
    SectorFrontmatter,
    NoteType,
    ThesisStatus,
    TradeStatus,
    TradeDirection,
    ConvictionLevel,
    EventType,
)


class TestNoteFrontmatter:
    """Tests for NoteFrontmatter."""

    def test_frontmatter_creation(self):
        fm = NoteFrontmatter(
            title="Test Note",
            note_type=NoteType.GENERAL,
            tags=["test", "example"],
        )
        assert fm.title == "Test Note"
        assert fm.note_type == NoteType.GENERAL
        assert "test" in fm.tags

    def test_frontmatter_to_yaml(self):
        fm = NoteFrontmatter(title="Test", tags=["a", "b"])
        yaml_str = fm.to_yaml()
        assert "title: Test" in yaml_str
        assert "tags:" in yaml_str

    def test_frontmatter_from_yaml(self):
        yaml_str = """
title: My Note
type: general
tags:
  - test
  - example
"""
        fm = NoteFrontmatter.from_yaml(yaml_str)
        assert fm.title == "My Note"
        assert fm.note_type == NoteType.GENERAL
        assert "test" in fm.tags


class TestThesisFrontmatter:
    """Tests for ThesisFrontmatter."""

    def test_thesis_creation(self):
        fm = ThesisFrontmatter(
            title="AAPL Thesis",
            symbol="AAPL",
            company_name="Apple Inc.",
            sector="Technology",
            status=ThesisStatus.RESEARCH,
            conviction=ConvictionLevel.HIGH,
            entry_price=175.0,
            target_price=200.0,
        )
        assert fm.symbol == "AAPL"
        assert fm.status == ThesisStatus.RESEARCH
        assert fm.conviction == ConvictionLevel.HIGH
        assert fm.note_type == NoteType.THESIS

    def test_thesis_to_yaml(self):
        fm = ThesisFrontmatter(
            title="AAPL Thesis",
            symbol="AAPL",
            conviction=ConvictionLevel.HIGH,
        )
        yaml_str = fm.to_yaml()
        assert "symbol: AAPL" in yaml_str
        assert "conviction: high" in yaml_str

    def test_thesis_from_yaml(self):
        yaml_str = """
title: AAPL Thesis
type: thesis
symbol: AAPL
status: active
conviction: high
entry_price: 175.0
"""
        fm = ThesisFrontmatter.from_yaml(yaml_str)
        assert fm.symbol == "AAPL"
        assert fm.status == ThesisStatus.ACTIVE
        assert fm.conviction == ConvictionLevel.HIGH
        assert fm.entry_price == 175.0


class TestTradeFrontmatter:
    """Tests for TradeFrontmatter."""

    def test_trade_creation(self):
        fm = TradeFrontmatter(
            title="AAPL Long",
            symbol="AAPL",
            direction=TradeDirection.LONG,
            status=TradeStatus.OPEN,
            entry_price=175.0,
            shares=100,
        )
        assert fm.symbol == "AAPL"
        assert fm.direction == TradeDirection.LONG
        assert fm.note_type == NoteType.TRADE

    def test_trade_pnl_calculation(self):
        fm = TradeFrontmatter(
            title="AAPL Long",
            symbol="AAPL",
            direction=TradeDirection.LONG,
            status=TradeStatus.CLOSED,
            entry_price=175.0,
            exit_price=200.0,
            shares=100,
            commission=10.0,
        )
        # (200 - 175) * 100 - 10 = 2490
        assert fm.pnl == 2490.0
        # ((200/175) - 1) * 100 = 14.28%
        assert fm.pnl_percent == pytest.approx(14.28, rel=0.01)

    def test_trade_short_pnl(self):
        fm = TradeFrontmatter(
            title="AAPL Short",
            symbol="AAPL",
            direction=TradeDirection.SHORT,
            status=TradeStatus.CLOSED,
            entry_price=200.0,
            exit_price=175.0,
            shares=100,
            commission=10.0,
        )
        # (200 - 175) * 100 - 10 = 2490
        assert fm.pnl == 2490.0

    def test_trade_holding_period(self):
        fm = TradeFrontmatter(
            title="AAPL Long",
            symbol="AAPL",
            entry_date=datetime(2024, 1, 1),
            exit_date=datetime(2024, 1, 11),
            entry_price=175.0,
            shares=100,
        )
        assert fm.holding_period_days == 10


class TestNote:
    """Tests for Note class."""

    def test_note_from_markdown(self):
        md = """---
title: Test Note
type: general
tags:
  - test
---

# Content

This is the content with a [[Link]].
"""
        note = Note.from_markdown(Path("test.md"), md)
        assert note.frontmatter.title == "Test Note"
        assert "Link" in note.outgoing_links
        assert "[[Link]]" in note.content

    def test_note_to_markdown(self):
        fm = NoteFrontmatter(title="Test", tags=["a"])
        note = Note(
            path=Path("test.md"),
            frontmatter=fm,
            content="# Hello\n\nWorld",
        )
        md = note.to_markdown()
        assert "---" in md
        assert "title: Test" in md
        assert "# Hello" in md

    def test_note_outgoing_links(self):
        fm = NoteFrontmatter(title="Test")
        note = Note(
            path=Path("test.md"),
            frontmatter=fm,
            content="Links to [[Company A]] and [[Company B|Display Text]]",
        )
        links = note.outgoing_links
        assert "Company A" in links
        assert "Company B" in links
        assert len(links) == 2


class TestTemplates:
    """Tests for Templates."""

    def test_investment_thesis_template(self):
        fm, content = Templates.investment_thesis(
            symbol="AAPL",
            company_name="Apple Inc.",
            sector="Technology",
        )
        assert fm.symbol == "AAPL"
        assert fm.note_type == NoteType.THESIS
        assert "Investment Thesis" in fm.title
        assert "Apple" in content
        assert "Valuation" in content

    def test_trade_journal_template(self):
        fm, content = Templates.trade_journal(
            symbol="AAPL",
            direction=TradeDirection.LONG,
            entry_price=175.50,
            shares=100,
        )
        assert fm.symbol == "AAPL"
        assert fm.direction == TradeDirection.LONG
        assert fm.note_type == NoteType.TRADE
        assert "175.50" in content

    def test_company_research_template(self):
        fm, content = Templates.company_research(
            symbol="AAPL",
            company_name="Apple Inc.",
            sector="Technology",
        )
        assert fm.note_type == NoteType.COMPANY
        assert "Apple" in content

    def test_daily_note_template(self):
        fm, content = Templates.daily_note()
        assert fm.note_type == NoteType.DAILY
        assert "Market Overview" in content

    def test_event_note_template(self):
        fm, content = Templates.event_note(
            symbol="AAPL",
            company_name="Apple Inc.",
            event_type=EventType.EARNINGS_CALL,
            host="JPMorgan",
            participants=["Tim Cook", "Luca Maestri"],
        )
        assert fm.note_type == NoteType.EVENT
        assert fm.event_type == EventType.EARNINGS_CALL
        assert fm.symbol == "AAPL"
        assert "[[Tim Cook]]" in fm.participants
        assert "Key Takeaways" in content
        assert "Q&A Session" in content

    def test_person_profile_template(self):
        fm, content = Templates.person_profile(
            full_name="Tim Cook",
            current_role="CEO",
            current_company="Apple",
            linkedin_url="https://linkedin.com/in/timcook",
        )
        assert fm.note_type == NoteType.PERSON
        assert fm.full_name == "Tim Cook"
        assert fm.current_role == "CEO"
        assert "[[Apple]]" in fm.current_company
        assert "Career History" in content
        assert "Red Flags" in content
        assert "Green Flags" in content

    def test_sector_overview_enhanced_template(self):
        fm, content = Templates.sector_overview_enhanced(
            sector_name="Technology",
            sub_sectors=["Software", "Hardware"],
            companies=["Apple", "Microsoft"],
        )
        assert fm.note_type == NoteType.SECTOR
        assert fm.sector_name == "Technology"
        assert "[[Apple]]" in fm.companies_covered
        assert "Moat Analysis" in content
        assert "Valuation Benchmarks" in content


class TestVault:
    """Tests for Vault."""

    def test_vault_creation(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            vault = Vault(tmpdir)
            assert vault.path.exists()
            assert (vault.path / "Theses").exists()
            assert (vault.path / "Trades").exists()
            assert (vault.path / "Events").exists()
            assert (vault.path / "People").exists()
            assert (vault.path / "Companies").exists()
            assert (vault.path / "Sectors").exists()

    def test_vault_create_note(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            vault = Vault(tmpdir)
            note = vault.create_note(
                name="Test Note",
                content="Hello world",
                frontmatter=NoteFrontmatter(title="Test Note"),
            )
            assert note.name == "Test Note"
            assert note.path.exists()

    def test_vault_get_note(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            vault = Vault(tmpdir)
            vault.create_note(
                name="Test",
                content="Content",
                frontmatter=NoteFrontmatter(title="Test"),
            )
            note = vault.get("Test")
            assert note is not None
            assert note.frontmatter.title == "Test"

    def test_vault_search(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            vault = Vault(tmpdir)
            vault.create_note(
                name="Apple Note",
                content="Apple is a great company",
                frontmatter=NoteFrontmatter(title="Apple Note"),
            )
            results = vault.search("Apple")
            assert len(results) > 0

    def test_vault_backlinks(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            vault = Vault(tmpdir)
            vault.create_note(
                name="Company A",
                content="About Company A",
                frontmatter=NoteFrontmatter(title="Company A"),
            )
            vault.create_note(
                name="Thesis",
                content="This thesis is about [[Company A]]",
                frontmatter=NoteFrontmatter(title="Thesis"),
            )
            vault.load()  # Rebuild backlinks
            backlinks = vault.get_backlinks("Company A")
            assert len(backlinks) == 1
            assert backlinks[0].name == "Thesis"


class TestNoteManager:
    """Tests for NoteManager."""

    def test_manager_creation(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            assert manager.vault.path.exists()
            assert manager.health_check()

    def test_create_thesis(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            thesis = manager.create_thesis(
                symbol="AAPL",
                company_name="Apple Inc.",
                sector="Technology",
                conviction="high",
            )
            assert thesis.name == "AAPL Investment Thesis"
            assert thesis.path.exists()

    def test_create_trade(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            trade = manager.create_trade(
                symbol="AAPL",
                direction="long",
                entry_price=175.50,
                shares=100,
            )
            assert "AAPL" in trade.name
            assert trade.path.exists()

    def test_get_theses(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            manager.create_thesis(symbol="AAPL", sector="Tech")
            manager.create_thesis(symbol="GOOGL", sector="Tech")

            theses = manager.get_theses()
            assert len(theses) == 2

    def test_get_trades(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            manager.create_trade(symbol="AAPL", entry_price=175.0, shares=100)
            manager.create_trade(symbol="GOOGL", entry_price=140.0, shares=50)

            trades = manager.get_trades()
            assert len(trades) == 2

    def test_trade_stats_empty(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            stats = manager.get_trade_stats()
            assert stats["total_trades"] == 0

    def test_search(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            manager.create_thesis(symbol="AAPL", company_name="Apple Inc.")
            results = manager.search("Apple")
            assert len(results) > 0

    def test_create_event(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            event = manager.create_event(
                symbol="AAPL",
                company_name="Apple Inc.",
                event_type="earnings_call",
                host="JPMorgan",
                participants=["Tim Cook", "Luca Maestri"],
            )
            assert "AAPL" in event.name
            assert "Earnings Call" in event.name
            assert event.path.exists()
            # Verify created in Events folder
            assert "Events" in str(event.path)

    def test_create_person(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            person = manager.create_person(
                full_name="Tim Cook",
                current_role="CEO",
                current_company="Apple",
                linkedin_url="https://linkedin.com/in/timcook",
            )
            assert person.name == "Tim Cook"
            assert person.path.exists()
            # Verify created in People folder
            assert "People" in str(person.path)

    def test_create_sector(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            sector = manager.create_sector(
                sector_name="Technology",
                sub_sectors=["Software", "Hardware"],
                companies=["Apple", "Microsoft"],
            )
            assert "Technology" in sector.name
            assert sector.path.exists()

    def test_get_events(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            manager.create_event(symbol="AAPL", event_type="earnings_call")
            manager.create_event(symbol="GOOGL", event_type="conference")
            manager.create_event(symbol="AAPL", event_type="investor_day")

            # Get all events
            all_events = manager.get_events()
            assert len(all_events) == 3

            # Filter by symbol
            aapl_events = manager.get_events(symbol="AAPL")
            assert len(aapl_events) == 2

            # Filter by event type
            earnings = manager.get_events(event_type="earnings_call")
            assert len(earnings) == 1

    def test_get_people(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            manager.create_person(
                full_name="Tim Cook", current_role="CEO", current_company="Apple"
            )
            manager.create_person(
                full_name="Satya Nadella",
                current_role="CEO",
                current_company="Microsoft",
            )
            manager.create_person(
                full_name="Luca Maestri", current_role="CFO", current_company="Apple"
            )

            # Get all people
            all_people = manager.get_people()
            assert len(all_people) == 3

            # Filter by company
            apple_people = manager.get_people(company="Apple")
            assert len(apple_people) == 2

            # Filter by role
            ceos = manager.get_people(role="CEO")
            assert len(ceos) == 2

    def test_get_sectors(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = NoteManager(tmpdir)
            manager.create_sector(sector_name="Technology")
            manager.create_sector(sector_name="Healthcare")

            sectors = manager.get_sectors()
            assert len(sectors) == 2
