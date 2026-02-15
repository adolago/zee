"""
Search API Router

Provides semantic search endpoints using Qdrant vector database.
"""

import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from stanley.search import (
    CollectionStats,
    DocumentIndexer,
    RAGContextRequest,
    RAGContextResponse,
    SemanticSearchRequest,
    SemanticSearchResponse,
    SimilarDocumentsRequest,
    SimilarDocumentsResponse,
    SourceType,
    VectorStore,
    VectorStoreError,
)
from stanley.api.utils import sanitize_log_input, sanitize_html, sanitize_error

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/search", tags=["search"])

# Global vector store instance (initialized on startup)
_vector_store: Optional[VectorStore] = None
_indexer: Optional[DocumentIndexer] = None


async def get_vector_store() -> VectorStore:
    """Get the vector store instance."""
    global _vector_store
    if _vector_store is None:
        _vector_store = VectorStore(mode="local")
        await _vector_store.initialize()
    return _vector_store


async def get_indexer() -> DocumentIndexer:
    """Get the document indexer instance."""
    global _indexer
    if _indexer is None:
        store = await get_vector_store()
        _indexer = DocumentIndexer(store)
    return _indexer


@router.on_event("shutdown")
async def shutdown_vector_store():
    """Close the vector store on shutdown."""
    global _vector_store
    if _vector_store:
        await _vector_store.close()
        _vector_store = None


@router.get("/health")
async def search_health():
    """Check search service health."""
    try:
        store = await get_vector_store()
        healthy = await store.health_check()
        return {
            "status": "healthy" if healthy else "unhealthy",
            "service": "vector_search",
        }
    except Exception as e:
        logger.error(f"Search health check failed: {e}")
        return {
            "status": "unhealthy",
            "service": "vector_search",
            "error": sanitize_error(e),
        }


@router.post("/semantic", response_model=SemanticSearchResponse)
async def semantic_search(
    request: SemanticSearchRequest,
    store: VectorStore = Depends(get_vector_store),
):
    """
    Perform semantic search across all indexed content.

    Searches research notes, SEC filings, and earnings transcripts
    using vector similarity.
    """
    start_time = time.time()

    try:
        results = await store.search(
            query=request.query,
            limit=request.limit,
            min_score=request.min_score,
            source_types=request.source_types,
            symbols=request.symbols,
            date_from=request.date_from,
            date_to=request.date_to,
        )

        search_time_ms = (time.time() - start_time) * 1000

        return SemanticSearchResponse(
            query=request.query,
            results=results,
            total_results=len(results),
            search_time_ms=search_time_ms,
        )

    except VectorStoreError as e:
        logger.error(f"Semantic search failed: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/notes")
async def search_notes(
    query: str = Query(..., max_length=1000, description="Search query"),
    limit: int = Query(10, ge=1, le=100, description="Maximum results"),
    symbol: Optional[str] = Query(None, max_length=20, description="Filter by symbol"),
    min_score: float = Query(0.5, ge=0, le=1, description="Minimum similarity"),
    store: VectorStore = Depends(get_vector_store),
):
    """
    Search only research notes.

    Filters to notes and research reports, excluding SEC filings
    and transcripts.
    """
    start_time = time.time()

    try:
        symbols = [symbol.upper()] if symbol else None

        results = await store.search(
            query=query,
            collection="research_notes",
            limit=limit,
            min_score=min_score,
            symbols=symbols,
        )

        search_time_ms = (time.time() - start_time) * 1000

        return {
            "query": query,
            "results": results,
            "total_results": len(results),
            "search_time_ms": search_time_ms,
        }

    except VectorStoreError as e:
        logger.error(f"Notes search failed: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/filings/{symbol}")
async def search_filings(
    symbol: str,
    query: str = Query(..., max_length=1000, description="Search query"),
    limit: int = Query(10, ge=1, le=100, description="Maximum results"),
    filing_type: Optional[str] = Query(
        None, description="Filter by filing type (10-K, 10-Q, 8-K)"
    ),
    min_score: float = Query(0.5, ge=0, le=1, description="Minimum similarity"),
    store: VectorStore = Depends(get_vector_store),
):
    """
    Search SEC filings for a specific symbol.

    Searches through 10-K, 10-Q, and 8-K filing content.
    """
    start_time = time.time()

    try:
        results = await store.search(
            query=query,
            collection="sec_filings",
            limit=limit,
            min_score=min_score,
            symbols=[symbol.upper()],
        )

        # Filter by filing type if specified
        if filing_type:
            results = [
                r
                for r in results
                if r.metadata.get("filing_type", "").upper() == filing_type.upper()
            ]

        search_time_ms = (time.time() - start_time) * 1000

        return {
            "symbol": symbol.upper(),
            "query": query,
            "filing_type": filing_type,
            "results": results,
            "total_results": len(results),
            "search_time_ms": search_time_ms,
        }

    except VectorStoreError as e:
        logger.error(f"Filings search failed: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.post("/similar/{symbol}", response_model=SimilarDocumentsResponse)
async def find_similar_companies(
    symbol: str,
    request: SimilarDocumentsRequest,
    store: VectorStore = Depends(get_vector_store),
):
    """
    Find companies with similar investment characteristics.

    Uses the investment thesis or other documents for the given symbol
    to find similar companies in the index.
    """
    try:
        # Get the document vector for this symbol
        document_vector = await store.get_document_vector(
            document_id=f"{symbol.upper()}-thesis",
            collection="research_notes",
        )

        if not document_vector:
            # Try to find any document for this symbol
            results = await store.search(
                query=f"{symbol} investment thesis",
                collection="research_notes",
                limit=1,
                symbols=[symbol.upper()],
            )

            if not results:
                raise HTTPException(
                    status_code=404,
                    detail=f"No indexed content found for symbol: {symbol}",
                )

            # Use the first result's content to find similar
            document_vector = await store._embedding.embed_text(results[0].text)

        # Search for similar documents, excluding the original symbol
        similar_results = await store.search_by_vector(
            vector=document_vector,
            collection="research_notes",
            limit=request.limit + 10,  # Get extra to filter out same symbol
            min_score=0.5,
        )

        # Filter out documents for the same symbol
        filtered_results = [
            r
            for r in similar_results
            if r.symbol and r.symbol.upper() != symbol.upper()
        ][: request.limit]

        return SimilarDocumentsResponse(
            symbol=symbol.upper(),
            based_on=request.based_on,
            similar=filtered_results,
        )

    except HTTPException:
        raise
    except VectorStoreError as e:
        logger.error(f"Similar companies search failed: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.post("/rag", response_model=RAGContextResponse)
async def get_rag_context(
    request: RAGContextRequest,
    store: VectorStore = Depends(get_vector_store),
):
    """
    Retrieve context chunks for RAG (Retrieval Augmented Generation).

    Returns the most relevant document chunks for a given query,
    suitable for providing context to an LLM.
    """
    try:
        results = await store.search(
            query=request.query,
            limit=request.max_chunks,
            min_score=0.5,
            source_types=request.sources,
            symbols=request.symbols,
        )

        # Estimate tokens (rough approximation)
        total_tokens = 0
        context_chunks = []

        for result in results:
            # Rough token estimate: ~4 chars per token
            chunk_tokens = len(result.text) // 4

            if total_tokens + chunk_tokens <= request.max_tokens:
                context_chunks.append(result)
                total_tokens += chunk_tokens
            else:
                break

        return RAGContextResponse(
            query=request.query,
            context_chunks=context_chunks,
            total_tokens=total_tokens,
        )

    except VectorStoreError as e:
        logger.error(f"RAG context retrieval failed: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/collections")
async def list_collections(
    store: VectorStore = Depends(get_vector_store),
):
    """List all search collections with statistics."""
    try:
        collections = []

        for name in store.DEFAULT_COLLECTIONS:
            try:
                stats = await store.get_collection_stats(name)
                collections.append(stats)
            except Exception as e:
                logger.warning(f"Could not get stats for {name}: {e}")
                collections.append(
                    CollectionStats(
                        name=name,
                        vectors_count=0,
                        points_count=0,
                        segments_count=0,
                        status="unknown",
                    )
                )

        return {"collections": collections}

    except Exception as e:
        logger.error(f"Failed to list collections: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.post("/index/note")
async def index_note(
    note_id: str,
    content: str,
    symbol: Optional[str] = None,
    note_type: Optional[str] = None,
    indexer: DocumentIndexer = Depends(get_indexer),
):
    """
    Index a research note for semantic search.

    This endpoint is typically called automatically when notes are
    created or updated.
    """
    try:
        # Sanitize HTML content to prevent XSS
        # This is critical as search results may be displayed in the UI
        safe_content = sanitize_html(content)

        count = await indexer.index_note(
            note_id=note_id,
            content=safe_content,
            symbol=symbol,
            note_type=note_type,
        )

        return {
            "status": "indexed",
            "note_id": note_id,
            "chunks_created": count,
        }

    except Exception as e:
        logger.error("Failed to index note %s: %s", sanitize_log_input(note_id), e)
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.delete("/index/{document_id}")
async def remove_from_index(
    document_id: str,
    source_type: SourceType = Query(
        SourceType.NOTE, description="Document source type"
    ),
    indexer: DocumentIndexer = Depends(get_indexer),
):
    """Remove a document from the search index."""
    try:
        await indexer.remove_document(document_id, source_type)

        return {
            "status": "removed",
            "document_id": document_id,
        }

    except Exception as e:
        logger.error(
            "Failed to remove document %s: %s", sanitize_log_input(document_id), e
        )
        raise HTTPException(status_code=500, detail=sanitize_error(e))
