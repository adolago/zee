"""
Document Indexer Module

Handles chunking and indexing of documents for vector search.
Supports notes, SEC filings, and earnings transcripts.
"""

import hashlib
import logging
import re
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from .models import DocumentChunk, SourceType
from .vector_store import VectorStore
from stanley.api.utils import sanitize_log_input

logger = logging.getLogger(__name__)


class TextChunker:
    """
    Utility class for chunking text documents.

    Supports multiple chunking strategies:
    - By token count (approximate)
    - By section headers
    - By paragraphs
    """

    def __init__(
        self,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        min_chunk_size: int = 100,
    ):
        """
        Initialize the text chunker.

        Args:
            chunk_size: Target tokens per chunk (approximate)
            chunk_overlap: Tokens to overlap between chunks
            min_chunk_size: Minimum tokens for a chunk
        """
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.min_chunk_size = min_chunk_size

    def _estimate_tokens(self, text: str) -> int:
        """Estimate token count (rough approximation: ~4 chars per token)."""
        return len(text) // 4

    def chunk_by_tokens(self, text: str) -> list[str]:
        """
        Chunk text by approximate token count.

        Args:
            text: Text to chunk

        Returns:
            List of text chunks
        """
        if not text.strip():
            return []

        # Split into sentences
        sentences = re.split(r"(?<=[.!?])\s+", text)

        chunks = []
        current_chunk = []
        current_size = 0

        for sentence in sentences:
            sentence_tokens = self._estimate_tokens(sentence)

            if current_size + sentence_tokens > self.chunk_size and current_chunk:
                # Save current chunk
                chunk_text = " ".join(current_chunk)
                if self._estimate_tokens(chunk_text) >= self.min_chunk_size:
                    chunks.append(chunk_text)

                # Start new chunk with overlap
                overlap_sentences = []
                overlap_size = 0
                for s in reversed(current_chunk):
                    s_tokens = self._estimate_tokens(s)
                    if overlap_size + s_tokens <= self.chunk_overlap:
                        overlap_sentences.insert(0, s)
                        overlap_size += s_tokens
                    else:
                        break

                current_chunk = overlap_sentences
                current_size = overlap_size

            current_chunk.append(sentence)
            current_size += sentence_tokens

        # Don't forget the last chunk
        if current_chunk:
            chunk_text = " ".join(current_chunk)
            if self._estimate_tokens(chunk_text) >= self.min_chunk_size:
                chunks.append(chunk_text)

        return chunks

    def chunk_by_sections(
        self,
        text: str,
        section_pattern: str = r"^#{1,3}\s+.+$",
    ) -> list[tuple[str, str]]:
        """
        Chunk text by section headers.

        Args:
            text: Text to chunk
            section_pattern: Regex pattern for section headers

        Returns:
            List of (section_name, section_text) tuples
        """
        lines = text.split("\n")
        sections = []
        current_section = ""
        current_content = []

        for line in lines:
            if re.match(section_pattern, line, re.MULTILINE):
                # Save previous section
                if current_content:
                    content = "\n".join(current_content).strip()
                    if content:
                        sections.append((current_section, content))

                current_section = line.strip().lstrip("#").strip()
                current_content = []
            else:
                current_content.append(line)

        # Don't forget the last section
        if current_content:
            content = "\n".join(current_content).strip()
            if content:
                sections.append((current_section, content))

        return sections

    def chunk_by_paragraphs(self, text: str) -> list[str]:
        """
        Chunk text by paragraphs, combining small paragraphs.

        Args:
            text: Text to chunk

        Returns:
            List of paragraph chunks
        """
        paragraphs = re.split(r"\n\s*\n", text)

        chunks = []
        current_chunk = []
        current_size = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            para_tokens = self._estimate_tokens(para)

            if current_size + para_tokens > self.chunk_size and current_chunk:
                chunks.append("\n\n".join(current_chunk))
                current_chunk = []
                current_size = 0

            current_chunk.append(para)
            current_size += para_tokens

        if current_chunk:
            chunks.append("\n\n".join(current_chunk))

        return [c for c in chunks if self._estimate_tokens(c) >= self.min_chunk_size]


class DocumentIndexer:
    """
    Handles indexing of documents into the vector store.

    Supports:
    - Research notes (from NoteManager)
    - SEC filings (from AccountingAnalyzer)
    - Earnings transcripts
    """

    def __init__(
        self,
        vector_store: VectorStore,
        chunker: Optional[TextChunker] = None,
    ):
        """
        Initialize the document indexer.

        Args:
            vector_store: VectorStore instance for storing embeddings
            chunker: TextChunker instance (uses default if not provided)
        """
        self.vector_store = vector_store
        self.chunker = chunker or TextChunker()
        self._indexed_documents: dict[str, datetime] = {}

    def _generate_chunk_id(self, document_id: str, chunk_index: int) -> str:
        """Generate a deterministic chunk ID."""
        content = f"{document_id}:{chunk_index}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    async def index_note(
        self,
        note_id: str,
        content: str,
        symbol: Optional[str] = None,
        note_type: Optional[str] = None,
        created_at: Optional[datetime] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> int:
        """
        Index a research note.

        Args:
            note_id: Unique note identifier
            content: Note content (markdown)
            symbol: Stock symbol if applicable
            note_type: Type of note (thesis, trade, etc.)
            created_at: Note creation date
            metadata: Additional metadata

        Returns:
            Number of chunks indexed
        """
        # First, remove any existing chunks for this document
        await self.vector_store.delete(
            collection="research_notes",
            document_id=note_id,
        )

        # Chunk by sections first, then by tokens if sections are too large
        sections = self.chunker.chunk_by_sections(content)

        chunks = []
        chunk_index = 0

        for section_name, section_content in sections:
            # If section is small enough, index as-is
            if (
                self.chunker._estimate_tokens(section_content)
                <= self.chunker.chunk_size
            ):
                chunks.append(
                    DocumentChunk(
                        id=self._generate_chunk_id(note_id, chunk_index),
                        text=section_content,
                        source_type=SourceType.NOTE,
                        document_id=note_id,
                        symbol=symbol.upper() if symbol else None,
                        section=section_name or None,
                        date=created_at,
                        chunk_index=chunk_index,
                        metadata={
                            **(metadata or {}),
                            "note_type": note_type,
                        },
                    )
                )
                chunk_index += 1
            else:
                # Further chunk large sections
                sub_chunks = self.chunker.chunk_by_tokens(section_content)
                for sub_chunk in sub_chunks:
                    chunks.append(
                        DocumentChunk(
                            id=self._generate_chunk_id(note_id, chunk_index),
                            text=sub_chunk,
                            source_type=SourceType.NOTE,
                            document_id=note_id,
                            symbol=symbol.upper() if symbol else None,
                            section=section_name or None,
                            date=created_at,
                            chunk_index=chunk_index,
                            metadata={
                                **(metadata or {}),
                                "note_type": note_type,
                            },
                        )
                    )
                    chunk_index += 1

        # If no sections found, chunk the entire content
        if not chunks:
            text_chunks = self.chunker.chunk_by_tokens(content)
            for i, text in enumerate(text_chunks):
                chunks.append(
                    DocumentChunk(
                        id=self._generate_chunk_id(note_id, i),
                        text=text,
                        source_type=SourceType.NOTE,
                        document_id=note_id,
                        symbol=symbol.upper() if symbol else None,
                        date=created_at,
                        chunk_index=i,
                        metadata={
                            **(metadata or {}),
                            "note_type": note_type,
                        },
                    )
                )

        # Upsert to vector store
        count = await self.vector_store.upsert(
            collection="research_notes",
            chunks=chunks,
        )

        self._indexed_documents[note_id] = datetime.now()
        logger.info("Indexed note %s: %d chunks", sanitize_log_input(note_id), count)

        return count

    async def index_sec_filing(
        self,
        filing_id: str,
        symbol: str,
        filing_type: str,
        sections: dict[str, str],
        filing_date: Optional[datetime] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> int:
        """
        Index an SEC filing.

        Args:
            filing_id: Unique filing identifier (e.g., accession number)
            symbol: Stock symbol
            filing_type: Filing type (10-K, 10-Q, 8-K, etc.)
            sections: Dict mapping section names to content
            filing_date: Filing date
            metadata: Additional metadata

        Returns:
            Number of chunks indexed
        """
        # Remove existing chunks for this filing
        await self.vector_store.delete(
            collection="sec_filings",
            document_id=filing_id,
        )

        chunks = []
        chunk_index = 0

        for section_name, section_content in sections.items():
            if not section_content.strip():
                continue

            # Chunk large sections
            text_chunks = self.chunker.chunk_by_tokens(section_content)

            for text in text_chunks:
                chunks.append(
                    DocumentChunk(
                        id=self._generate_chunk_id(filing_id, chunk_index),
                        text=text,
                        source_type=SourceType.SEC_FILING,
                        document_id=filing_id,
                        symbol=symbol.upper(),
                        section=section_name,
                        date=filing_date,
                        chunk_index=chunk_index,
                        metadata={
                            **(metadata or {}),
                            "filing_type": filing_type,
                        },
                    )
                )
                chunk_index += 1

        # Upsert to vector store
        count = await self.vector_store.upsert(
            collection="sec_filings",
            chunks=chunks,
        )

        self._indexed_documents[filing_id] = datetime.now()
        logger.info(f"Indexed SEC filing {filing_id} ({filing_type}): {count} chunks")

        return count

    async def index_transcript(
        self,
        transcript_id: str,
        symbol: str,
        content: str,
        event_type: str = "earnings_call",
        event_date: Optional[datetime] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> int:
        """
        Index an earnings transcript.

        Args:
            transcript_id: Unique transcript identifier
            symbol: Stock symbol
            content: Transcript content
            event_type: Type of event (earnings_call, investor_day, etc.)
            event_date: Event date
            metadata: Additional metadata

        Returns:
            Number of chunks indexed
        """
        # Remove existing chunks
        await self.vector_store.delete(
            collection="earnings_transcripts",
            document_id=transcript_id,
        )

        # Try to chunk by speaker turns (common in transcripts)
        speaker_pattern = r"^(?:Q\s*[-–—]|A\s*[-–—]|[A-Z][a-z]+\s+[A-Z][a-z]+\s*[-–—:])"

        # Split by speaker turns
        turns = re.split(f"({speaker_pattern})", content, flags=re.MULTILINE)

        chunks = []
        chunk_index = 0
        current_speaker = ""
        current_content = []

        for i, segment in enumerate(turns):
            if re.match(speaker_pattern, segment):
                # Save previous speaker's content
                if current_content:
                    text = " ".join(current_content).strip()
                    if text:
                        # Further chunk if too long
                        sub_chunks = self.chunker.chunk_by_tokens(text)
                        for sub_chunk in sub_chunks:
                            chunks.append(
                                DocumentChunk(
                                    id=self._generate_chunk_id(
                                        transcript_id, chunk_index
                                    ),
                                    text=sub_chunk,
                                    source_type=SourceType.EARNINGS_TRANSCRIPT,
                                    document_id=transcript_id,
                                    symbol=symbol.upper(),
                                    section=current_speaker or None,
                                    date=event_date,
                                    chunk_index=chunk_index,
                                    metadata={
                                        **(metadata or {}),
                                        "event_type": event_type,
                                        "speaker": current_speaker,
                                    },
                                )
                            )
                            chunk_index += 1

                current_speaker = segment.strip().rstrip("-–—:")
                current_content = []
            else:
                current_content.append(segment)

        # Don't forget the last speaker
        if current_content:
            text = " ".join(current_content).strip()
            if text:
                sub_chunks = self.chunker.chunk_by_tokens(text)
                for sub_chunk in sub_chunks:
                    chunks.append(
                        DocumentChunk(
                            id=self._generate_chunk_id(transcript_id, chunk_index),
                            text=sub_chunk,
                            source_type=SourceType.EARNINGS_TRANSCRIPT,
                            document_id=transcript_id,
                            symbol=symbol.upper(),
                            section=current_speaker or None,
                            date=event_date,
                            chunk_index=chunk_index,
                            metadata={
                                **(metadata or {}),
                                "event_type": event_type,
                                "speaker": current_speaker,
                            },
                        )
                    )
                    chunk_index += 1

        # If no speaker turns found, just chunk the whole thing
        if not chunks:
            text_chunks = self.chunker.chunk_by_tokens(content)
            for i, text in enumerate(text_chunks):
                chunks.append(
                    DocumentChunk(
                        id=self._generate_chunk_id(transcript_id, i),
                        text=text,
                        source_type=SourceType.EARNINGS_TRANSCRIPT,
                        document_id=transcript_id,
                        symbol=symbol.upper(),
                        date=event_date,
                        chunk_index=i,
                        metadata={
                            **(metadata or {}),
                            "event_type": event_type,
                        },
                    )
                )

        # Upsert to vector store
        count = await self.vector_store.upsert(
            collection="earnings_transcripts",
            chunks=chunks,
        )

        self._indexed_documents[transcript_id] = datetime.now()
        logger.info(f"Indexed transcript {transcript_id}: {count} chunks")

        return count

    async def remove_document(
        self,
        document_id: str,
        source_type: SourceType,
    ) -> None:
        """
        Remove a document from the index.

        Args:
            document_id: Document ID to remove
            source_type: Source type to determine collection
        """
        collection_map = {
            SourceType.NOTE: "research_notes",
            SourceType.RESEARCH_REPORT: "research_notes",
            SourceType.SEC_FILING: "sec_filings",
            SourceType.EARNINGS_TRANSCRIPT: "earnings_transcripts",
        }

        collection = collection_map.get(source_type, "research_notes")

        await self.vector_store.delete(
            collection=collection,
            document_id=document_id,
        )

        if document_id in self._indexed_documents:
            del self._indexed_documents[document_id]

        logger.info(
            "Removed document %s from %s", sanitize_log_input(document_id), collection
        )

    def is_indexed(self, document_id: str) -> bool:
        """Check if a document is already indexed."""
        return document_id in self._indexed_documents

    def get_indexed_date(self, document_id: str) -> Optional[datetime]:
        """Get the date a document was indexed."""
        return self._indexed_documents.get(document_id)
