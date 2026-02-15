"""
Vector Store Module

Qdrant-based vector storage for semantic search.
Supports local mode (in-memory or disk) and Qdrant Cloud.
"""

import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from .embeddings import EmbeddingProvider, create_embedding_provider
from .models import (
    CollectionStats,
    DocumentChunk,
    SearchResult,
    SourceType,
)

logger = logging.getLogger(__name__)


class VectorStoreError(Exception):
    """Base exception for vector store errors."""


class CollectionNotFoundError(VectorStoreError):
    """Raised when a collection doesn't exist."""


class VectorStore:
    """
    Qdrant-based vector store for semantic search.

    Supports multiple deployment modes:
    - In-memory (for testing)
    - Local disk persistence
    - Qdrant Cloud

    Collections:
    - research_notes: Investment theses, trade journals, company notes
    - sec_filings: SEC document chunks (10-K, 10-Q, 8-K sections)
    - earnings_transcripts: Earnings call transcript chunks
    """

    # Default collections with their configurations
    DEFAULT_COLLECTIONS = {
        "research_notes": {
            "description": "Investment theses, trade journals, company notes",
            "source_types": [SourceType.NOTE, SourceType.RESEARCH_REPORT],
        },
        "sec_filings": {
            "description": "SEC document chunks",
            "source_types": [SourceType.SEC_FILING],
        },
        "earnings_transcripts": {
            "description": "Earnings call transcript chunks",
            "source_types": [SourceType.EARNINGS_TRANSCRIPT],
        },
    }

    def __init__(
        self,
        mode: str = "local",
        path: Optional[str] = None,
        url: Optional[str] = None,
        api_key: Optional[str] = None,
        embedding_provider: Optional[EmbeddingProvider] = None,
        embedding_config: Optional[dict] = None,
    ):
        """
        Initialize the vector store.

        Args:
            mode: Deployment mode ("memory", "local", "cloud")
            path: Path for local disk storage (required for mode="local")
            url: Qdrant Cloud URL (required for mode="cloud")
            api_key: Qdrant Cloud API key (required for mode="cloud")
            embedding_provider: Pre-configured embedding provider
            embedding_config: Config dict for creating embedding provider
        """
        self._mode = mode
        self._path = path
        self._url = url
        self._api_key = api_key
        self._client = None
        self._initialized = False

        # Set up embedding provider
        if embedding_provider:
            self._embedding = embedding_provider
        elif embedding_config:
            self._embedding = create_embedding_provider(**embedding_config)
        else:
            self._embedding = create_embedding_provider()

        logger.info(
            f"VectorStore configured: mode={mode}, "
            f"embedding={self._embedding.name}/{self._embedding.model_name}"
        )

    @property
    def dimension(self) -> int:
        """Get the embedding dimension."""
        return self._embedding.dimension

    def _get_client(self):
        """Lazy-load the Qdrant client."""
        if self._client is None:
            try:
                from qdrant_client import QdrantClient

                if self._mode == "memory":
                    self._client = QdrantClient(":memory:")
                    logger.info("Initialized Qdrant client in memory mode")
                elif self._mode == "local":
                    if not self._path:
                        self._path = str(Path.home() / ".stanley" / "qdrant")
                    Path(self._path).mkdir(parents=True, exist_ok=True)
                    self._client = QdrantClient(path=self._path)
                    logger.info(
                        f"Initialized Qdrant client with local storage: {self._path}"
                    )
                elif self._mode == "cloud":
                    if not self._url:
                        raise ValueError("URL required for cloud mode")
                    self._client = QdrantClient(
                        url=self._url,
                        api_key=self._api_key,
                        prefer_grpc=True,
                    )
                    logger.info(f"Initialized Qdrant client with cloud: {self._url}")
                else:
                    raise ValueError(f"Unknown mode: {self._mode}")

            except ImportError:
                raise ImportError(
                    "qdrant-client is required for VectorStore. "
                    "Install with: pip install qdrant-client"
                )

        return self._client

    async def initialize(self) -> None:
        """Initialize the vector store and create default collections."""
        if self._initialized:
            return

        client = self._get_client()

        # Create default collections if they don't exist
        for collection_name in self.DEFAULT_COLLECTIONS:
            await self._ensure_collection(collection_name)

        self._initialized = True
        logger.info("VectorStore initialized with default collections")

    async def close(self) -> None:
        """Close the vector store connection."""
        if self._client:
            self._client.close()
            self._client = None
        self._initialized = False

    async def __aenter__(self):
        """Async context manager entry."""
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()

    async def _ensure_collection(self, name: str) -> None:
        """Ensure a collection exists, creating it if necessary."""
        from qdrant_client.models import Distance, VectorParams

        client = self._get_client()

        if not client.collection_exists(name):
            client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(
                    size=self.dimension,
                    distance=Distance.COSINE,
                ),
            )
            logger.info(f"Created collection: {name}")

    async def create_collection(self, name: str) -> None:
        """
        Create a new collection.

        Args:
            name: Collection name
        """
        await self._ensure_collection(name)

    async def delete_collection(self, name: str) -> None:
        """
        Delete a collection.

        Args:
            name: Collection name
        """
        client = self._get_client()
        if client.collection_exists(name):
            client.delete_collection(name)
            logger.info(f"Deleted collection: {name}")

    async def get_collection_stats(self, name: str) -> CollectionStats:
        """
        Get statistics for a collection.

        Args:
            name: Collection name

        Returns:
            Collection statistics
        """
        client = self._get_client()

        if not client.collection_exists(name):
            raise CollectionNotFoundError(f"Collection not found: {name}")

        info = client.get_collection(name)

        # qdrant-client field names can vary across versions
        vectors_count = getattr(info, "vectors_count", None)
        if vectors_count is None:
            vectors_count = getattr(info, "indexed_vectors_count", 0)

        return CollectionStats(
            name=name,
            vectors_count=vectors_count or 0,
            points_count=getattr(info, "points_count", 0) or 0,
            segments_count=getattr(info, "segments_count", 0) or 0,
            status=info.status.value if getattr(info, "status", None) else "unknown",
        )

    async def upsert(
        self,
        collection: str,
        chunks: list[DocumentChunk],
        batch_size: int = 100,
    ) -> int:
        """
        Upsert document chunks into a collection.

        Args:
            collection: Collection name
            chunks: List of document chunks to upsert
            batch_size: Number of chunks to process per batch

        Returns:
            Number of chunks upserted
        """
        from qdrant_client.models import PointStruct

        if not chunks:
            return 0

        await self._ensure_collection(collection)
        client = self._get_client()

        # Process in batches
        total_upserted = 0

        for i in range(0, len(chunks), batch_size):
            batch = chunks[i : i + batch_size]
            texts = [chunk.text for chunk in batch]

            # Generate embeddings
            embeddings = await self._embedding.embed_batch(texts)

            # Create points
            points = []
            for chunk, embedding in zip(batch, embeddings):
                # Generate ID if not provided
                point_id = chunk.id or str(uuid4())

                payload = {
                    "text": chunk.text,
                    "source_type": chunk.source_type.value,
                    "document_id": chunk.document_id,
                    "chunk_index": chunk.chunk_index,
                }

                if chunk.symbol:
                    payload["symbol"] = chunk.symbol
                if chunk.section:
                    payload["section"] = chunk.section
                if chunk.date:
                    payload["date"] = chunk.date.isoformat()
                if chunk.metadata:
                    payload["metadata"] = chunk.metadata

                points.append(
                    PointStruct(
                        id=point_id,
                        vector=embedding,
                        payload=payload,
                    )
                )

            # Upsert batch
            client.upsert(collection_name=collection, points=points)
            total_upserted += len(points)

        logger.info(f"Upserted {total_upserted} chunks to {collection}")
        return total_upserted

    async def delete(
        self,
        collection: str,
        ids: Optional[list[str]] = None,
        document_id: Optional[str] = None,
        symbol: Optional[str] = None,
    ) -> int:
        """
        Delete points from a collection.

        Args:
            collection: Collection name
            ids: Specific point IDs to delete
            document_id: Delete all points with this document ID
            symbol: Delete all points with this symbol

        Returns:
            Number of points deleted (estimated)
        """
        from qdrant_client.models import Filter, FieldCondition, MatchValue

        client = self._get_client()

        if ids:
            # Delete by IDs
            client.delete(collection_name=collection, points_selector=ids)
            return len(ids)

        # Build filter for deletion
        conditions = []
        if document_id:
            conditions.append(
                FieldCondition(key="document_id", match=MatchValue(value=document_id))
            )
        if symbol:
            conditions.append(
                FieldCondition(key="symbol", match=MatchValue(value=symbol))
            )

        if conditions:
            client.delete(
                collection_name=collection,
                points_selector=Filter(must=conditions),
            )
            return -1  # Unknown count

        return 0

    async def search(
        self,
        query: str,
        collection: Optional[str] = None,
        limit: int = 10,
        min_score: float = 0.5,
        source_types: Optional[list[SourceType]] = None,
        symbols: Optional[list[str]] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
    ) -> list[SearchResult]:
        """
        Search for similar documents.

        Args:
            query: Search query text
            collection: Specific collection to search (searches all if None)
            limit: Maximum results to return
            min_score: Minimum similarity score
            source_types: Filter by source types
            symbols: Filter by stock symbols
            date_from: Filter by date range start
            date_to: Filter by date range end

        Returns:
            List of search results
        """
        from qdrant_client.models import (
            Filter,
            FieldCondition,
            MatchAny,
            MatchValue,
            Range,
        )

        client = self._get_client()

        # Generate query embedding
        query_embedding = await self._embedding.embed_text(query)

        # Build filter conditions
        conditions = []

        if source_types:
            conditions.append(
                FieldCondition(
                    key="source_type",
                    match=MatchAny(any=[st.value for st in source_types]),
                )
            )

        if symbols:
            conditions.append(
                FieldCondition(
                    key="symbol",
                    match=MatchAny(any=[s.upper() for s in symbols]),
                )
            )

        if date_from or date_to:
            date_range = {}
            if date_from:
                date_range["gte"] = date_from.isoformat()
            if date_to:
                date_range["lte"] = date_to.isoformat()
            conditions.append(FieldCondition(key="date", range=Range(**date_range)))

        search_filter = Filter(must=conditions) if conditions else None

        # Determine collections to search
        if collection:
            collections = [collection]
        else:
            # Search all default collections
            collections = list(self.DEFAULT_COLLECTIONS.keys())

        # Search each collection
        all_results = []

        for coll in collections:
            if not client.collection_exists(coll):
                continue

            results = client.search(
                collection_name=coll,
                query_vector=query_embedding,
                query_filter=search_filter,
                limit=limit,
                score_threshold=min_score,
            )

            for result in results:
                payload = result.payload or {}
                all_results.append(
                    SearchResult(
                        id=str(result.id),
                        text=payload.get("text", ""),
                        score=result.score,
                        source_type=SourceType(payload.get("source_type", "note")),
                        document_id=payload.get("document_id", ""),
                        symbol=payload.get("symbol"),
                        section=payload.get("section"),
                        date=(
                            datetime.fromisoformat(payload["date"])
                            if payload.get("date")
                            else None
                        ),
                        metadata=payload.get("metadata", {}),
                    )
                )

        # Sort by score and limit
        all_results.sort(key=lambda x: x.score, reverse=True)
        return all_results[:limit]

    async def search_by_vector(
        self,
        vector: list[float],
        collection: str,
        limit: int = 10,
        min_score: float = 0.5,
        exclude_ids: Optional[list[str]] = None,
    ) -> list[SearchResult]:
        """
        Search using a pre-computed vector.

        Args:
            vector: Query vector
            collection: Collection to search
            limit: Maximum results
            min_score: Minimum similarity score
            exclude_ids: Point IDs to exclude from results

        Returns:
            List of search results
        """
        client = self._get_client()

        if not client.collection_exists(collection):
            return []

        # Build filter to exclude specific IDs
        search_filter = None
        if exclude_ids:
            from qdrant_client.models import Filter, HasIdCondition

            search_filter = Filter(must_not=[HasIdCondition(has_id=exclude_ids)])

        results = client.search(
            collection_name=collection,
            query_vector=vector,
            query_filter=search_filter,
            limit=limit,
            score_threshold=min_score,
        )

        return [
            SearchResult(
                id=str(r.id),
                text=r.payload.get("text", "") if r.payload else "",
                score=r.score,
                source_type=(
                    SourceType(r.payload.get("source_type", "note"))
                    if r.payload
                    else SourceType.NOTE
                ),
                document_id=r.payload.get("document_id", "") if r.payload else "",
                symbol=r.payload.get("symbol") if r.payload else None,
                section=r.payload.get("section") if r.payload else None,
                date=(
                    datetime.fromisoformat(r.payload["date"])
                    if r.payload and r.payload.get("date")
                    else None
                ),
                metadata=r.payload.get("metadata", {}) if r.payload else {},
            )
            for r in results
        ]

    async def get_document_vector(
        self,
        document_id: str,
        collection: str,
    ) -> Optional[list[float]]:
        """
        Get the average vector for a document.

        Args:
            document_id: Document ID to get vector for
            collection: Collection to search

        Returns:
            Average vector for the document, or None if not found
        """
        from qdrant_client.models import Filter, FieldCondition, MatchValue

        client = self._get_client()

        if not client.collection_exists(collection):
            return None

        # Find all points for this document
        results = client.scroll(
            collection_name=collection,
            scroll_filter=Filter(
                must=[
                    FieldCondition(
                        key="document_id", match=MatchValue(value=document_id)
                    )
                ]
            ),
            with_vectors=True,
            limit=1000,
        )

        points = results[0]
        if not points:
            return None

        # Compute average vector
        import numpy as np

        vectors = [p.vector for p in points if p.vector]
        if not vectors:
            return None

        avg_vector = np.mean(vectors, axis=0)
        return avg_vector.tolist()

    async def health_check(self) -> bool:
        """Check if the vector store is operational."""
        try:
            client = self._get_client()
            # Try to list collections
            client.get_collections()
            return True
        except Exception as e:
            logger.error(f"Vector store health check failed: {e}")
            return False
