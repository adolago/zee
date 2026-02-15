"""
Stanley Search Module

Provides semantic search capabilities using Qdrant vector database.
Supports searching across research notes, SEC filings, and earnings transcripts.

Example usage:
    from stanley.search import VectorStore, DocumentIndexer

    # Initialize vector store
    store = VectorStore(mode="local")
    await store.initialize()

    # Create indexer
    indexer = DocumentIndexer(store)

    # Index a note
    await indexer.index_note(
        note_id="thesis-aapl-001",
        content="Apple investment thesis...",
        symbol="AAPL",
        note_type="thesis",
    )

    # Search
    results = await store.search(
        query="companies with strong recurring revenue",
        limit=10,
    )
"""

from .embeddings import (
    EmbeddingProvider,
    FastEmbedProvider,
    OpenAIEmbeddingProvider,
    SentenceTransformerProvider,
    create_embedding_provider,
)
from .indexer import DocumentIndexer, TextChunker
from .models import (
    CollectionStats,
    DocumentChunk,
    IndexingStatus,
    RAGContextRequest,
    RAGContextResponse,
    SearchResult,
    SemanticSearchRequest,
    SemanticSearchResponse,
    SimilarDocumentsRequest,
    SimilarDocumentsResponse,
    SourceType,
)
from .vector_store import (
    CollectionNotFoundError,
    VectorStore,
    VectorStoreError,
)

__all__ = [
    # Vector Store
    "VectorStore",
    "VectorStoreError",
    "CollectionNotFoundError",
    # Embeddings
    "EmbeddingProvider",
    "FastEmbedProvider",
    "OpenAIEmbeddingProvider",
    "SentenceTransformerProvider",
    "create_embedding_provider",
    # Indexer
    "DocumentIndexer",
    "TextChunker",
    # Models
    "SourceType",
    "DocumentChunk",
    "SearchResult",
    "SemanticSearchRequest",
    "SemanticSearchResponse",
    "SimilarDocumentsRequest",
    "SimilarDocumentsResponse",
    "RAGContextRequest",
    "RAGContextResponse",
    "IndexingStatus",
    "CollectionStats",
]
