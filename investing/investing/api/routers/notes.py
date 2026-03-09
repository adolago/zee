"""
Investing Notes Router

FastAPI router for research vault operations including notes, theses, and trade journal.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..dependencies import get_note_manager
from investing.notes import NoteManager
from investing.api.utils import (
    create_response,
    sanitize_error,
    sanitize_html,
    sanitize_log_input,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Notes"])


# =============================================================================
# Pydantic Models - Request Types
# =============================================================================


class CreateThesisRequest(BaseModel):
    """Request to create an investment thesis."""

    symbol: str = Field(..., description="Stock symbol", max_length=20)
    company_name: str = Field(default="", description="Company name", max_length=200)
    sector: str = Field(default="", description="Sector/industry", max_length=100)
    conviction: str = Field(
        default="medium", description="Conviction level", max_length=100
    )
    content: Optional[str] = Field(
        default=None, description="Custom content", max_length=100000
    )


class CreateTradeRequest(BaseModel):
    """Request to create a trade journal entry."""

    symbol: str = Field(..., description="Stock symbol", max_length=20)
    direction: str = Field(default="long", description="Trade direction", max_length=50)
    entry_price: float = Field(default=0.0, ge=0, description="Entry price")
    shares: float = Field(default=0.0, ge=0, description="Number of shares")
    entry_date: Optional[str] = Field(
        default=None, description="Entry date (ISO format)"
    )
    content: Optional[str] = Field(
        default=None, description="Custom content", max_length=100000
    )


class CloseTradeRequest(BaseModel):
    """Request to close a trade."""

    exit_price: float = Field(..., ge=0, description="Exit price")
    exit_date: Optional[str] = Field(default=None, description="Exit date (ISO format)")
    exit_reason: str = Field(default="", description="Reason for exit", max_length=1000)
    lessons: str = Field(default="", description="Lessons learned", max_length=1000)
    grade: str = Field(default="", description="Self-assessment grade", max_length=50)


class CreateEventRequest(BaseModel):
    """Request to create an event note."""

    symbol: str = Field(..., description="Stock symbol", max_length=20)
    company_name: str = Field(default="", description="Company name", max_length=200)
    event_type: str = Field(
        default="conference",
        description="Event type (earnings_call, investor_day, conference, etc.)",
        max_length=100,
    )
    event_date: Optional[str] = Field(
        default=None, description="Event date (ISO format)"
    )
    host: str = Field(
        default="", description="Bank/broker hosting the event", max_length=100
    )
    participants: List[str] = Field(default=[], description="List of participant names")
    content: Optional[str] = Field(
        default=None, description="Custom content", max_length=100000
    )


class CreatePersonRequest(BaseModel):
    """Request to create a person/executive profile."""

    full_name: str = Field(..., description="Person's full name", max_length=200)
    current_role: str = Field(
        default="", description="Current role (CEO, CFO, etc.)", max_length=100
    )
    current_company: str = Field(
        default="", description="Current company name", max_length=100
    )
    linkedin_url: str = Field(
        default="", description="LinkedIn profile URL", max_length=500
    )
    content: Optional[str] = Field(
        default=None, description="Custom content", max_length=100000
    )


class CreateSectorRequest(BaseModel):
    """Request to create a sector overview."""

    sector_name: str = Field(..., description="Sector name", max_length=100)
    sub_sectors: List[str] = Field(default=[], description="List of sub-sectors")
    companies: List[str] = Field(default=[], description="List of companies covered")
    content: Optional[str] = Field(
        default=None, description="Custom content", max_length=100000
    )


class UpdateNoteRequest(BaseModel):
    """Request to update a note."""

    content: str = Field(..., description="New content", max_length=100000)


class CreateNoteRequest(BaseModel):
    """Request to create a generic note."""

    name: str = Field(..., description="Note name", max_length=200)
    content: str = Field(default="", description="Note content", max_length=100000)
    note_type: str = Field(default="note", description="Note type", max_length=100)
    tags: List[str] = Field(default=[], description="Tags for the note")


# =============================================================================
# Response Models
# =============================================================================


class NoteResponse(BaseModel):
    """Note response model."""

    name: str
    note_type: str
    created: str
    modified: str
    tags: List[str] = []
    links: List[str] = []


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool
    data: Optional[dict | list] = None
    error: Optional[str] = None
    timestamp: str


# =============================================================================
# Helper Functions
# =============================================================================


def get_timestamp() -> str:
    """Get current ISO timestamp."""
    from datetime import datetime

    return datetime.utcnow().isoformat() + "Z"


# =============================================================================
# Notes Endpoints
# =============================================================================


@router.get("/notes")
async def list_notes(
    note_type: Optional[str] = None,
    tags: Optional[str] = None,
    limit: int = 100,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """
    List notes with optional filters.

    Args:
        note_type: Filter by type (thesis, trade, company, etc.)
        tags: Comma-separated list of tags
        limit: Maximum results
    """
    try:
        tag_list = tags.split(",") if tags else None
        notes = note_manager.list_notes(note_type=note_type, tags=tag_list, limit=limit)

        return create_response(data=[n.to_dict() for n in notes])

    except Exception as e:
        logger.error(f"Error listing notes: {sanitize_log_input(e)}", exc_info=True)
        return create_response(error=sanitize_error(e), success=False)


@router.get("/notes/search")
async def search_notes(
    query: str,
    limit: int = 50,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """
    Full-text search across notes.

    Args:
        query: Search query
        limit: Maximum results
    """
    try:
        results = note_manager.search(query, limit)
        return create_response(data=results)

    except Exception as e:
        logger.error(f"Error searching notes: {sanitize_log_input(e)}", exc_info=True)
        return create_response(error=sanitize_error(e), success=False)


@router.get("/notes/graph")
async def get_notes_graph(
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Get the note graph for visualization."""
    try:
        graph = note_manager.get_graph()
        return create_response(data=graph)

    except Exception as e:
        logger.error(
            f"Error getting notes graph: {sanitize_log_input(e)}", exc_info=True
        )
        return create_response(error=sanitize_error(e), success=False)


@router.get("/notes/{name}")
async def get_note(
    name: str,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Get a specific note by name."""
    try:
        note = note_manager.get_note(name)
        if not note:
            raise HTTPException(status_code=404, detail=f"Note not found: {name}")

        return create_response(
            data={
                **note.to_dict(),
                "content": note.content,
                "frontmatter": note.frontmatter.to_yaml(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error getting note {sanitize_log_input(name)}: {sanitize_log_input(e)}",
            exc_info=True,
        )
        return create_response(error=sanitize_error(e), success=False)


@router.get("/notes/{name}/backlinks")
async def get_note_backlinks(
    name: str,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Get all notes that link to the given note."""
    try:
        backlinks = note_manager.get_backlinks(name)
        return create_response(data=[n.to_dict() for n in backlinks])

    except Exception as e:
        logger.error(
            f"Error getting backlinks for {sanitize_log_input(name)}: {sanitize_log_input(e)}",
            exc_info=True,
        )
        return create_response(error=sanitize_error(e), success=False)


@router.put("/notes/{name}")
async def update_note(
    name: str,
    request: UpdateNoteRequest,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Create or update a note's content (upsert)."""
    try:
        # Sanitize HTML content to prevent XSS
        safe_content = sanitize_html(request.content)
        note = note_manager.upsert_note(name, safe_content)
        return create_response(data=note.to_dict())

    except Exception as e:
        logger.error(
            f"Error saving note {sanitize_log_input(name)}: {sanitize_log_input(e)}",
            exc_info=True,
        )
        return create_response(error=sanitize_error(e), success=False)


@router.delete("/notes/{name}")
async def delete_note(
    name: str,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Delete a note."""
    try:
        deleted = note_manager.delete_note(name)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Note not found: {name}")

        return create_response(data={"deleted": name})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error deleting note {sanitize_log_input(name)}: {sanitize_log_input(e)}",
            exc_info=True,
        )
        return create_response(error=sanitize_error(e), success=False)


# =============================================================================
# Thesis Endpoints
# =============================================================================


@router.get("/theses")
async def list_theses(
    status: Optional[str] = None,
    symbol: Optional[str] = None,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """
    List investment theses.

    Args:
        status: Filter by status (research, watchlist, active, closed, invalidated)
        symbol: Filter by symbol
    """
    try:
        theses = note_manager.get_theses(status=status, symbol=symbol)
        return create_response(data=[t.to_dict() for t in theses])

    except Exception as e:
        logger.error(f"Error listing theses: {sanitize_log_input(e)}", exc_info=True)
        return create_response(error=sanitize_error(e), success=False)


@router.post("/theses")
async def create_thesis(
    request: CreateThesisRequest,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Create a new investment thesis."""
    try:
        # Sanitize HTML content to prevent XSS
        safe_content = sanitize_html(request.content) if request.content else None

        thesis = note_manager.create_thesis(
            symbol=request.symbol,
            company_name=request.company_name,
            sector=request.sector,
            conviction=request.conviction,
            content=safe_content,
        )

        return create_response(data=thesis.to_dict())

    except Exception as e:
        logger.error(f"Error creating thesis: {sanitize_log_input(e)}", exc_info=True)
        return create_response(error=sanitize_error(e), success=False)


# =============================================================================
# Trade Journal Endpoints
# =============================================================================


@router.get("/trades")
async def list_trades(
    status: Optional[str] = None,
    symbol: Optional[str] = None,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """
    List trade journal entries.

    Args:
        status: Filter by status (open, closed, partial)
        symbol: Filter by symbol
    """
    try:
        trades = note_manager.get_trades(status=status, symbol=symbol)
        return create_response(data=[t.to_dict() for t in trades])

    except Exception as e:
        logger.error(f"Error listing trades: {sanitize_log_input(e)}", exc_info=True)
        return create_response(error=sanitize_error(e), success=False)


@router.post("/trades")
async def create_trade(
    request: CreateTradeRequest,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Create a new trade journal entry."""
    try:
        # Sanitize HTML content to prevent XSS
        safe_content = sanitize_html(request.content) if request.content else None

        trade = note_manager.create_trade(
            symbol=request.symbol,
            direction=request.direction,
            entry_price=request.entry_price,
            shares=request.shares,
            entry_date=request.entry_date,
            content=safe_content,
        )

        return create_response(data=trade.to_dict())

    except Exception as e:
        logger.error(f"Error creating trade: {sanitize_log_input(e)}", exc_info=True)
        return create_response(error=sanitize_error(e), success=False)


@router.post("/trades/{name}/close")
async def close_trade(
    name: str,
    request: CloseTradeRequest,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Close an open trade."""
    try:
        trade = note_manager.close_trade(
            trade_name=name,
            exit_price=request.exit_price,
            exit_date=request.exit_date,
            exit_reason=request.exit_reason,
            lessons=request.lessons,
            grade=request.grade,
        )

        return create_response(data=trade.to_dict())

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(
            f"Error closing trade {sanitize_log_input(name)}: {sanitize_log_input(e)}",
            exc_info=True,
        )
        return create_response(error=sanitize_error(e), success=False)


@router.get("/trades/stats")
async def get_trade_stats(
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Get aggregate trade statistics."""
    try:
        stats = note_manager.get_trade_stats()
        return create_response(data=stats)

    except Exception as e:
        logger.error(
            f"Error getting trade stats: {sanitize_log_input(e)}", exc_info=True
        )
        return create_response(error=sanitize_error(e), success=False)


# =============================================================================
# Event Endpoints
# =============================================================================


@router.get("/events")
async def list_events(
    event_type: Optional[str] = None,
    symbol: Optional[str] = None,
    company: Optional[str] = None,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """
    List event notes (conference calls, investor days, etc.).

    Args:
        event_type: Filter by type (earnings_call, conference, investor_day, etc.)
        symbol: Filter by stock symbol
        company: Filter by company name
    """
    try:
        events = note_manager.get_events(
            event_type=event_type, symbol=symbol, company=company
        )
        return create_response(data=[e.to_dict() for e in events])

    except Exception as e:
        logger.error(f"Error listing events: {sanitize_log_input(e)}", exc_info=True)
        return create_response(error=sanitize_error(e), success=False)


@router.post("/events")
async def create_event(
    request: CreateEventRequest,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Create a new event note."""
    try:
        # Sanitize HTML content to prevent XSS
        safe_content = sanitize_html(request.content) if request.content else None

        event = note_manager.create_event(
            symbol=request.symbol,
            company_name=request.company_name,
            event_type=request.event_type,
            event_date=request.event_date,
            host=request.host,
            participants=request.participants,
            content=safe_content,
        )

        return create_response(data=event.to_dict())

    except Exception as e:
        logger.error(f"Error creating event: {sanitize_log_input(e)}", exc_info=True)
        return create_response(error=sanitize_error(e), success=False)


# =============================================================================
# People Endpoints
# =============================================================================


@router.get("/people")
async def list_people(
    company: Optional[str] = None,
    role: Optional[str] = None,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """
    List person/executive profile notes.

    Args:
        company: Filter by company name
        role: Filter by role (CEO, CFO, etc.)
    """
    try:
        people = note_manager.get_people(company=company, role=role)
        return create_response(data=[p.to_dict() for p in people])

    except Exception as e:
        logger.error(f"Error listing people: {sanitize_log_input(e)}", exc_info=True)
        return create_response(error=sanitize_error(e), success=False)


@router.post("/people")
async def create_person(
    request: CreatePersonRequest,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Create a new person/executive profile."""
    try:
        # Sanitize HTML content to prevent XSS
        safe_content = sanitize_html(request.content) if request.content else None

        person = note_manager.create_person(
            full_name=request.full_name,
            current_role=request.current_role,
            current_company=request.current_company,
            linkedin_url=request.linkedin_url,
            content=safe_content,
        )

        return create_response(data=person.to_dict())

    except Exception as e:
        logger.error(f"Error creating person: {sanitize_log_input(e)}", exc_info=True)
        return create_response(error=sanitize_error(e), success=False)


# =============================================================================
# Sector Endpoints
# =============================================================================


@router.get("/sectors")
async def list_sectors(
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Get all sector overview notes."""
    try:
        sectors = note_manager.get_sectors()
        return create_response(data=[s.to_dict() for s in sectors])

    except Exception as e:
        logger.error(f"Error listing sectors: {sanitize_log_input(e)}", exc_info=True)
        return create_response(error=sanitize_error(e), success=False)


@router.post("/sectors")
async def create_sector(
    request: CreateSectorRequest,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """Create a new sector overview."""
    try:
        # Sanitize HTML content to prevent XSS
        safe_content = sanitize_html(request.content) if request.content else None

        sector = note_manager.create_sector(
            sector_name=request.sector_name,
            sub_sectors=request.sub_sectors,
            companies=request.companies,
            content=safe_content,
        )

        return create_response(data=sector.to_dict())

    except Exception as e:
        logger.error(f"Error creating sector: {sanitize_log_input(e)}", exc_info=True)
        return create_response(error=sanitize_error(e), success=False)


# =============================================================================
# Daily Notes Endpoints
# =============================================================================


@router.post("/daily")
async def create_daily_note(
    date: Optional[str] = None,
    content: Optional[str] = None,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """
    Create a daily note.

    Args:
        date: Date (ISO format, defaults to today)
        content: Optional custom content
    """
    try:
        # Sanitize HTML content to prevent XSS
        safe_content = sanitize_html(content) if content else None

        note = note_manager.create_daily_note(date=date, content=safe_content)
        return create_response(data=note.to_dict())

    except Exception as e:
        logger.error(
            f"Error creating daily note: {sanitize_log_input(e)}", exc_info=True
        )
        return create_response(error=sanitize_error(e), success=False)


# =============================================================================
# Company Research Endpoints
# =============================================================================


@router.post("/companies")
async def create_company(
    symbol: str,
    company_name: str = "",
    sector: str = "",
    content: Optional[str] = None,
    note_manager: NoteManager = Depends(get_note_manager),
):
    """
    Create a company research note.

    Args:
        symbol: Stock symbol
        company_name: Full company name
        sector: Sector/industry
        content: Optional custom content
    """
    try:
        # Sanitize HTML content to prevent XSS
        safe_content = sanitize_html(content) if content else None

        note = note_manager.create_company(
            symbol=symbol,
            company_name=company_name,
            sector=sector,
            content=safe_content,
        )
        return create_response(data=note.to_dict())

    except Exception as e:
        logger.error(
            f"Error creating company note: {sanitize_log_input(e)}", exc_info=True
        )
        return create_response(error=sanitize_error(e), success=False)
