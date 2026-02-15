"""
Search Module Data Models

Pydantic models for vector search operations.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class SourceType(str, Enum):
    """Type of indexed document source."""

    NOTE = "note"
    SEC_FILING = "sec_filing"
    EARNINGS_TRANSCRIPT = "earnings_transcript"
    RESEARCH_REPORT = "research_report"


class DocumentChunk(BaseModel):
    """A chunk of text to be indexed."""

    id: str = Field(..., description="Unique identifier for this chunk")
    text: str = Field(..., description="The text content of the chunk")
    source_type: SourceType = Field(..., description="Type of source document")
    document_id: str = Field(..., description="ID of the parent document")
    symbol: Optional[str] = Field(None, description="Stock ticker if applicable")
    section: Optional[str] = Field(None, description="Document section name")
    date: Optional[datetime] = Field(None, description="Document date")
    chunk_index: int = Field(0, description="Position within the document")
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata"
    )


class SearchResult(BaseModel):
    """A single search result."""

    id: str = Field(..., description="Document chunk ID")
    text: str = Field(..., description="The matched text content")
    score: float = Field(..., description="Similarity score (0-1)")
    source_type: SourceType = Field(..., description="Type of source document")
    document_id: str = Field(..., description="ID of the parent document")
    symbol: Optional[str] = Field(None, description="Stock ticker if applicable")
    section: Optional[str] = Field(None, description="Document section name")
    date: Optional[datetime] = Field(None, description="Document date")
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata"
    )


class SemanticSearchRequest(BaseModel):
    """Request for semantic search."""

    query: str = Field(
        ...,
        description="Search query text",
        min_length=1,
        max_length=1000,
    )
    limit: int = Field(10, ge=1, le=100, description="Maximum results to return")
    source_types: Optional[list[SourceType]] = Field(
        None, description="Filter by source types"
    )
    symbols: Optional[list[str]] = Field(None, description="Filter by stock symbols")
    date_from: Optional[datetime] = Field(
        None, description="Filter by date range start"
    )
    date_to: Optional[datetime] = Field(None, description="Filter by date range end")
    min_score: float = Field(0.5, ge=0, le=1, description="Minimum similarity score")


class SemanticSearchResponse(BaseModel):
    """Response from semantic search."""

    query: str = Field(..., description="Original query")
    results: list[SearchResult] = Field(..., description="Search results")
    total_results: int = Field(..., description="Total number of results")
    search_time_ms: float = Field(..., description="Search duration in milliseconds")


class SimilarDocumentsRequest(BaseModel):
    """Request to find similar documents."""

    symbol: str = Field(..., description="Stock symbol to find similar companies for")
    based_on: str = Field(
        "investment_thesis",
        description="What to base similarity on (investment_thesis, risk_factors, business_model)",
    )
    limit: int = Field(5, ge=1, le=50, description="Maximum results to return")
    exclude_same_sector: bool = Field(
        False, description="Exclude companies in the same sector"
    )


class SimilarDocumentsResponse(BaseModel):
    """Response with similar documents/companies."""

    symbol: str = Field(..., description="Original symbol queried")
    based_on: str = Field(..., description="Similarity basis")
    similar: list[SearchResult] = Field(..., description="Similar documents/companies")


class RAGContextRequest(BaseModel):
    """Request for RAG context retrieval."""

    query: str = Field(..., description="Query for context retrieval")
    sources: list[SourceType] = Field(
        default_factory=lambda: [SourceType.NOTE, SourceType.SEC_FILING],
        description="Sources to search",
    )
    symbols: Optional[list[str]] = Field(None, description="Filter by symbols")
    max_chunks: int = Field(5, ge=1, le=20, description="Maximum context chunks")
    max_tokens: int = Field(2000, ge=100, le=8000, description="Maximum total tokens")


class RAGContextResponse(BaseModel):
    """Response with RAG context."""

    query: str = Field(..., description="Original query")
    context_chunks: list[SearchResult] = Field(..., description="Retrieved context")
    total_tokens: int = Field(..., description="Estimated total tokens")


class IndexingStatus(BaseModel):
    """Status of document indexing."""

    collection: str = Field(..., description="Collection name")
    total_documents: int = Field(..., description="Total documents indexed")
    last_indexed: Optional[datetime] = Field(None, description="Last indexing time")
    is_indexing: bool = Field(False, description="Whether indexing is in progress")


class CollectionStats(BaseModel):
    """Statistics for a vector collection."""

    name: str = Field(..., description="Collection name")
    vectors_count: int = Field(..., description="Number of vectors")
    points_count: int = Field(..., description="Number of points")
    segments_count: int = Field(..., description="Number of segments")
    status: str = Field(..., description="Collection status")
