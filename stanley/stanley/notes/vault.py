"""
Vault Module

Main vault class for managing notes, following Obsidian's vault concept.
Handles file operations, indexing, and bi-directional linking.
"""

import logging
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import (
    EventFrontmatter,
    EventType,
    Note,
    NoteFrontmatter,
    NoteType,
    PersonFrontmatter,
    ThesisFrontmatter,
    ThesisStatus,
    TradeFrontmatter,
    TradeStatus,
)

logger = logging.getLogger(__name__)


class Vault:
    """
    A vault of markdown notes with Obsidian-style features.

    Features:
    - Markdown files with YAML frontmatter
    - Wiki-style [[links]] with bi-directional linking
    - Full-text search with SQLite FTS5
    - Investment-specific note types (thesis, trade, company)
    """

    def __init__(self, vault_path: str | Path):
        """
        Initialize a vault.

        Args:
            vault_path: Path to the vault directory
        """
        self.path = Path(vault_path)
        self.path.mkdir(parents=True, exist_ok=True)

        # Create standard folders
        self._folders = {
            "theses": self.path / "Theses",
            "trades": self.path / "Trades",
            "companies": self.path / "Companies",
            "sectors": self.path / "Sectors",
            "events": self.path / "Events",
            "people": self.path / "People",
            "daily": self.path / "Daily",
            "templates": self.path / "Templates",
        }
        for folder in self._folders.values():
            folder.mkdir(exist_ok=True)

        # Database for indexing and search
        self._db_path = self.path / ".stanley" / "index.db"
        self._db_path.parent.mkdir(exist_ok=True)
        self._init_database()

        # In-memory cache of notes
        self._notes: Dict[str, Note] = {}
        self._loaded = False

        logger.info(f"Vault initialized at {self.path}")

    def _init_database(self) -> None:
        """Initialize SQLite database for indexing and FTS."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()

        # Notes table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                path TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                title TEXT,
                note_type TEXT,
                created TEXT,
                modified TEXT,
                tags TEXT,
                content TEXT
            )
        """)

        # Full-text search virtual table
        cursor.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                name,
                title,
                tags,
                content,
                content='notes',
                content_rowid='rowid'
            )
        """)

        # Links table for graph
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS links (
                source TEXT NOT NULL,
                target TEXT NOT NULL,
                PRIMARY KEY (source, target)
            )
        """)

        # Triggers to keep FTS in sync
        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
                INSERT INTO notes_fts(rowid, name, title, tags, content)
                VALUES (NEW.rowid, NEW.name, NEW.title, NEW.tags, NEW.content);
            END
        """)

        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
                INSERT INTO notes_fts(notes_fts, rowid, name, title, tags, content)
                VALUES ('delete', OLD.rowid, OLD.name, OLD.title, OLD.tags, OLD.content);
            END
        """)

        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
                INSERT INTO notes_fts(notes_fts, rowid, name, title, tags, content)
                VALUES ('delete', OLD.rowid, OLD.name, OLD.title, OLD.tags, OLD.content);
                INSERT INTO notes_fts(rowid, name, title, tags, content)
                VALUES (NEW.rowid, NEW.name, NEW.title, NEW.tags, NEW.content);
            END
        """)

        conn.commit()
        conn.close()

    def load(self) -> None:
        """Load all notes from the vault into memory."""
        self._notes.clear()

        for md_file in self.path.rglob("*.md"):
            # Skip templates
            if "Templates" in md_file.parts:
                continue

            try:
                content = md_file.read_text(encoding="utf-8")
                note = Note.from_markdown(md_file, content)
                self._notes[note.name] = note
            except Exception as e:
                logger.warning(f"Failed to load {md_file}: {e}")

        # Build backlinks
        self._build_backlinks()

        # Index all notes
        self._reindex()

        self._loaded = True
        logger.info(f"Loaded {len(self._notes)} notes from vault")

    def _build_backlinks(self) -> None:
        """Build bi-directional links between notes."""
        for note in self._notes.values():
            for link in note.outgoing_links:
                if link in self._notes:
                    self._notes[link].add_backlink(note.name)

    def _reindex(self) -> None:
        """Rebuild the search index."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()

        # Clear existing data
        cursor.execute("DELETE FROM notes")
        cursor.execute("DELETE FROM links")

        # Index all notes
        for note in self._notes.values():
            cursor.execute(
                """
                INSERT OR REPLACE INTO notes
                (path, name, title, note_type, created, modified, tags, content)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    str(note.path),
                    note.name,
                    note.frontmatter.title,
                    note.frontmatter.note_type.value,
                    note.frontmatter.created.isoformat(),
                    note.frontmatter.modified.isoformat(),
                    ",".join(note.frontmatter.tags),
                    note.content,
                ),
            )

            # Index links
            for link in note.outgoing_links:
                cursor.execute(
                    "INSERT OR IGNORE INTO links (source, target) VALUES (?, ?)",
                    (note.name, link),
                )

        conn.commit()
        conn.close()

    def get(self, name: str) -> Optional[Note]:
        """Get a note by name."""
        if not self._loaded:
            self.load()
        return self._notes.get(name)

    def list_notes(
        self,
        note_type: Optional[NoteType] = None,
        tags: Optional[List[str]] = None,
        limit: int = 100,
    ) -> List[Note]:
        """
        List notes with optional filters.

        Args:
            note_type: Filter by note type
            tags: Filter by tags (any match)
            limit: Maximum notes to return

        Returns:
            List of matching notes
        """
        if not self._loaded:
            self.load()

        results = []
        for note in self._notes.values():
            if note_type and note.frontmatter.note_type != note_type:
                continue
            if tags:
                if not any(t in note.frontmatter.tags for t in tags):
                    continue
            results.append(note)
            if len(results) >= limit:
                break

        return sorted(results, key=lambda n: n.frontmatter.modified, reverse=True)

    def search(self, query: str, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Full-text search across notes.

        Args:
            query: Search query (supports FTS5 syntax)
            limit: Maximum results

        Returns:
            List of search results with snippets
        """
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                notes.path,
                notes.name,
                notes.title,
                notes.note_type,
                snippet(notes_fts, 3, '<mark>', '</mark>', '...', 32) as snippet
            FROM notes_fts
            JOIN notes ON notes.rowid = notes_fts.rowid
            WHERE notes_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        """,
            (query, limit),
        )

        results = []
        for row in cursor.fetchall():
            results.append(
                {
                    "path": row[0],
                    "name": row[1],
                    "title": row[2],
                    "type": row[3],
                    "snippet": row[4],
                }
            )

        conn.close()
        return results

    def create_note(
        self,
        name: str,
        content: str = "",
        frontmatter: Optional[NoteFrontmatter] = None,
        folder: Optional[str] = None,
    ) -> Note:
        """
        Create a new note.

        Args:
            name: Note name (without .md extension)
            content: Note content (markdown)
            frontmatter: Note frontmatter
            folder: Subfolder (theses, trades, companies, etc.)

        Returns:
            Created note
        """
        if frontmatter is None:
            frontmatter = NoteFrontmatter(title=name)

        # Validate name for path traversal
        if "/" in name or "\\" in name or name in [".", ".."]:
            raise ValueError("Note name cannot contain path separators")

        # Determine folder based on note type or explicit folder
        if folder:
            target_folder = self._folders.get(folder, self.path)
        elif frontmatter.note_type == NoteType.THESIS:
            target_folder = self._folders["theses"]
        elif frontmatter.note_type == NoteType.TRADE:
            target_folder = self._folders["trades"]
        elif frontmatter.note_type == NoteType.COMPANY:
            target_folder = self._folders["companies"]
        elif frontmatter.note_type == NoteType.SECTOR:
            target_folder = self._folders["sectors"]
        elif frontmatter.note_type == NoteType.EVENT:
            target_folder = self._folders["events"]
        elif frontmatter.note_type == NoteType.PERSON:
            target_folder = self._folders["people"]
        elif frontmatter.note_type == NoteType.DAILY:
            target_folder = self._folders["daily"]
        else:
            target_folder = self.path

        # Validate name to prevent path traversal
        self._validate_name(name)

        # Create note file
        file_path = target_folder / f"{name}.md"
        note = Note(path=file_path, frontmatter=frontmatter, content=content)

        # Write to disk
        file_path.write_text(note.to_markdown(), encoding="utf-8")

        # Update cache
        self._notes[name] = note

        # Update index
        self._index_note(note)

        logger.info(f"Created note: {name}")
        return note

    def update_note(
        self, name: str, content: str, frontmatter: Optional[NoteFrontmatter] = None
    ) -> Note:
        """
        Update an existing note.

        Args:
            name: Note name
            content: New content
            frontmatter: New frontmatter (optional)

        Returns:
            Updated note
        """
        # Validate name for path traversal
        if ".." in name or "/" in name or "\\" in name:
            raise ValueError("Note name cannot contain path separators")

        note = self.get(name)
        if not note:
            raise ValueError(f"Note not found: {name}")

        if frontmatter:
            note.frontmatter = frontmatter
        note.frontmatter.modified = datetime.now()
        note.content = content
        note._outgoing_links = set()  # Clear cache to recalculate

        # Write to disk
        note.path.write_text(note.to_markdown(), encoding="utf-8")

        # Rebuild backlinks
        self._build_backlinks()

        # Update index
        self._index_note(note)

        logger.info(f"Updated note: {name}")
        return note

    def delete_note(self, name: str) -> bool:
        """
        Delete a note.

        Args:
            name: Note name

        Returns:
            True if deleted
        """
        note = self.get(name)
        if not note:
            return False

        # Delete file
        note.path.unlink()

        # Remove from cache
        del self._notes[name]

        # Remove from index
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM notes WHERE name = ?", (name,))
        cursor.execute("DELETE FROM links WHERE source = ? OR target = ?", (name, name))
        conn.commit()
        conn.close()

        logger.info(f"Deleted note: {name}")
        return True

    def _index_note(self, note: Note) -> None:
        """Index a single note."""
        conn = sqlite3.connect(self._db_path)
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT OR REPLACE INTO notes
            (path, name, title, note_type, created, modified, tags, content)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                str(note.path),
                note.name,
                note.frontmatter.title,
                note.frontmatter.note_type.value,
                note.frontmatter.created.isoformat(),
                note.frontmatter.modified.isoformat(),
                ",".join(note.frontmatter.tags),
                note.content,
            ),
        )

        # Update links
        cursor.execute("DELETE FROM links WHERE source = ?", (note.name,))
        for link in note.outgoing_links:
            cursor.execute(
                "INSERT OR IGNORE INTO links (source, target) VALUES (?, ?)",
                (note.name, link),
            )

        conn.commit()
        conn.close()

    def get_backlinks(self, name: str) -> List[Note]:
        """Get all notes that link to the given note."""
        if not self._loaded:
            self.load()

        note = self.get(name)
        if not note:
            return []

        return [
            self._notes[link] for link in note.incoming_links if link in self._notes
        ]

    def get_graph(self) -> Dict[str, Any]:
        """
        Get the note graph for visualization.

        Returns:
            Dict with nodes and edges for graph visualization
        """
        if not self._loaded:
            self.load()

        nodes = []
        edges = []

        for note in self._notes.values():
            nodes.append(
                {
                    "id": note.name,
                    "label": note.frontmatter.title,
                    "type": note.frontmatter.note_type.value,
                    "tags": note.frontmatter.tags,
                }
            )

            for link in note.outgoing_links:
                if link in self._notes:
                    edges.append({"source": note.name, "target": link})

        return {"nodes": nodes, "edges": edges}

    def get_theses(
        self,
        status: Optional[ThesisStatus] = None,
        symbol: Optional[str] = None,
    ) -> List[Note]:
        """Get investment thesis notes with optional filters."""
        theses = self.list_notes(note_type=NoteType.THESIS)

        if status:
            theses = [
                t
                for t in theses
                if isinstance(t.frontmatter, ThesisFrontmatter)
                and t.frontmatter.status == status
            ]

        if symbol:
            theses = [
                t
                for t in theses
                if isinstance(t.frontmatter, ThesisFrontmatter)
                and t.frontmatter.symbol.upper() == symbol.upper()
            ]

        return theses

    def get_trades(
        self,
        status: Optional[TradeStatus] = None,
        symbol: Optional[str] = None,
    ) -> List[Note]:
        """Get trade journal entries with optional filters."""
        trades = self.list_notes(note_type=NoteType.TRADE)

        if status:
            trades = [
                t
                for t in trades
                if isinstance(t.frontmatter, TradeFrontmatter)
                and t.frontmatter.status == status
            ]

        if symbol:
            trades = [
                t
                for t in trades
                if isinstance(t.frontmatter, TradeFrontmatter)
                and t.frontmatter.symbol.upper() == symbol.upper()
            ]

        return trades

    def get_events(
        self,
        event_type: Optional[EventType] = None,
        symbol: Optional[str] = None,
        company: Optional[str] = None,
    ) -> List[Note]:
        """
        Get event notes with optional filters.

        Args:
            event_type: Filter by event type (earnings_call, conference, etc.)
            symbol: Filter by stock symbol
            company: Filter by company name

        Returns:
            List of event notes sorted by event date (most recent first)
        """
        if not self._loaded:
            self.load()

        events = self.list_notes(note_type=NoteType.EVENT)

        if event_type:
            events = [
                e
                for e in events
                if isinstance(e.frontmatter, EventFrontmatter)
                and e.frontmatter.event_type == event_type
            ]

        if symbol:
            events = [
                e
                for e in events
                if isinstance(e.frontmatter, EventFrontmatter)
                and e.frontmatter.symbol.upper() == symbol.upper()
            ]

        if company:
            events = [
                e
                for e in events
                if isinstance(e.frontmatter, EventFrontmatter)
                and company.lower() in e.frontmatter.company.lower()
            ]

        # Sort by event date (most recent first)
        events.sort(
            key=lambda e: (
                e.frontmatter.event_date
                if isinstance(e.frontmatter, EventFrontmatter)
                and e.frontmatter.event_date
                else datetime.min
            ),
            reverse=True,
        )

        return events

    def get_people(
        self,
        company: Optional[str] = None,
        role: Optional[str] = None,
    ) -> List[Note]:
        """
        Get person/executive profile notes with optional filters.

        Args:
            company: Filter by company name
            role: Filter by role (CEO, CFO, etc.)

        Returns:
            List of person notes sorted alphabetically by name
        """
        if not self._loaded:
            self.load()

        people = self.list_notes(note_type=NoteType.PERSON)

        if company:
            people = [
                p
                for p in people
                if isinstance(p.frontmatter, PersonFrontmatter)
                and company.lower() in p.frontmatter.current_company.lower()
            ]

        if role:
            people = [
                p
                for p in people
                if isinstance(p.frontmatter, PersonFrontmatter)
                and role.lower() in p.frontmatter.current_role.lower()
            ]

        # Sort alphabetically by name
        people.sort(
            key=lambda p: (
                p.frontmatter.full_name
                if isinstance(p.frontmatter, PersonFrontmatter)
                else p.name
            )
        )

        return people

    def get_sectors(self) -> List[Note]:
        """
        Get all sector overview notes.

        Returns:
            List of sector notes sorted alphabetically
        """
        if not self._loaded:
            self.load()

        sectors = self.list_notes(note_type=NoteType.SECTOR)
        sectors.sort(key=lambda s: s.frontmatter.title)

        return sectors

    def get_trade_stats(self) -> Dict[str, Any]:
        """
        Get aggregate trade statistics.

        Returns:
            Dict with win rate, total P&L, etc.
        """
        trades = self.get_trades(status=TradeStatus.CLOSED)

        if not trades:
            return {
                "total_trades": 0,
                "winners": 0,
                "losers": 0,
                "win_rate": 0,
                "total_pnl": 0,
                "avg_win": 0,
                "avg_loss": 0,
                "profit_factor": 0,
            }

        winners = []
        losers = []
        total_pnl = 0

        for trade in trades:
            fm = trade.frontmatter
            if isinstance(fm, TradeFrontmatter) and fm.pnl is not None:
                total_pnl += fm.pnl
                if fm.pnl > 0:
                    winners.append(fm.pnl)
                else:
                    losers.append(fm.pnl)

        avg_win = sum(winners) / len(winners) if winners else 0
        avg_loss = abs(sum(losers) / len(losers)) if losers else 0
        profit_factor = (
            (sum(winners) / abs(sum(losers)))
            if losers and sum(losers) != 0
            else float("inf")
        )

        return {
            "total_trades": len(trades),
            "winners": len(winners),
            "losers": len(losers),
            "win_rate": (len(winners) / len(trades)) * 100 if trades else 0,
            "total_pnl": round(total_pnl, 2),
            "avg_win": round(avg_win, 2),
            "avg_loss": round(avg_loss, 2),
            "profit_factor": (
                round(profit_factor, 2) if profit_factor != float("inf") else "∞"
            ),
        }

    def health_check(self) -> bool:
        """Check if vault is operational."""
        return self.path.exists() and self._db_path.exists()

    def _validate_name(self, name: str) -> None:
        """
        Validate note name to prevent path traversal.

        Raises:
            ValueError: If name contains invalid characters or path components
        """
        if not name:
            raise ValueError("Note name cannot be empty")

        if (
            os.path.sep in name
            or (os.path.altsep and os.path.altsep in name)
            or "\\" in name
        ):
            raise ValueError("Note name cannot contain path separators")

        if ".." in name:
            # Stricter check: disallow '..' entirely to be safe,
            # though strictly speaking '..foo' is valid but confusing.
            # But since we already ban separators, '..' as a path component
            # is impossible unless the name is exactly '..'.
            if name == ".." or name == ".":
                raise ValueError("Note name cannot be '.' or '..'")
