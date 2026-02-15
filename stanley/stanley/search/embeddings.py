"""
Embedding Provider Module

Provides text embedding functionality for vector search.
Supports multiple backends: FastEmbed (default), OpenAI, and local sentence-transformers.
"""

import logging
from abc import ABC, abstractmethod
from typing import Optional

logger = logging.getLogger(__name__)


class EmbeddingProvider(ABC):
    """Abstract base class for embedding providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the provider name."""

    @property
    @abstractmethod
    def dimension(self) -> int:
        """Return the embedding dimension."""

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Return the model name."""

    @abstractmethod
    async def embed_text(self, text: str) -> list[float]:
        """
        Embed a single text string.

        Args:
            text: Text to embed

        Returns:
            Embedding vector as list of floats
        """

    @abstractmethod
    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """
        Embed multiple texts in a batch.

        Args:
            texts: List of texts to embed

        Returns:
            List of embedding vectors
        """


class FastEmbedProvider(EmbeddingProvider):
    """
    FastEmbed-based embedding provider.

    Uses the fastembed library which is integrated with qdrant-client.
    Recommended for simplicity and good performance.
    """

    # Model configurations: name -> dimension
    MODELS = {
        "BAAI/bge-small-en-v1.5": 384,
        "BAAI/bge-base-en-v1.5": 768,
        "sentence-transformers/all-MiniLM-L6-v2": 384,
        "sentence-transformers/paraphrase-MiniLM-L6-v2": 384,
    }

    def __init__(self, model_name: str = "BAAI/bge-small-en-v1.5"):
        """
        Initialize FastEmbed provider.

        Args:
            model_name: Name of the FastEmbed model to use
        """
        if model_name not in self.MODELS:
            raise ValueError(
                f"Unknown model: {model_name}. Available: {list(self.MODELS.keys())}"
            )

        self._model_name = model_name
        self._dimension = self.MODELS[model_name]
        self._model = None

    @property
    def name(self) -> str:
        return "fastembed"

    @property
    def dimension(self) -> int:
        return self._dimension

    @property
    def model_name(self) -> str:
        return self._model_name

    def _get_model(self):
        """Lazy-load the embedding model."""
        if self._model is None:
            try:
                from fastembed import TextEmbedding

                self._model = TextEmbedding(model_name=self._model_name)
                logger.info(f"Loaded FastEmbed model: {self._model_name}")
            except ImportError:
                raise ImportError(
                    "fastembed is required for FastEmbedProvider. "
                    "Install with: pip install fastembed"
                )
        return self._model

    async def embed_text(self, text: str) -> list[float]:
        """Embed a single text string."""
        model = self._get_model()
        embeddings = list(model.embed([text]))
        return embeddings[0].tolist()

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts in a batch."""
        if not texts:
            return []

        model = self._get_model()
        embeddings = list(model.embed(texts))
        return [emb.tolist() for emb in embeddings]


class OpenAIEmbeddingProvider(EmbeddingProvider):
    """
    OpenAI-based embedding provider.

    Uses OpenAI's embedding API for high-quality embeddings.
    Requires OPENAI_API_KEY environment variable.
    """

    MODELS = {
        "text-embedding-3-small": 1536,
        "text-embedding-3-large": 3072,
        "text-embedding-ada-002": 1536,
    }

    def __init__(
        self,
        model_name: str = "text-embedding-3-small",
        api_key: Optional[str] = None,
    ):
        """
        Initialize OpenAI embedding provider.

        Args:
            model_name: OpenAI embedding model name
            api_key: OpenAI API key (uses OPENAI_API_KEY env var if not provided)
        """
        if model_name not in self.MODELS:
            raise ValueError(
                f"Unknown model: {model_name}. Available: {list(self.MODELS.keys())}"
            )

        self._model_name = model_name
        self._dimension = self.MODELS[model_name]
        self._api_key = api_key
        self._client = None

    @property
    def name(self) -> str:
        return "openai"

    @property
    def dimension(self) -> int:
        return self._dimension

    @property
    def model_name(self) -> str:
        return self._model_name

    def _get_client(self):
        """Lazy-load the OpenAI client."""
        if self._client is None:
            try:
                from openai import AsyncOpenAI

                self._client = AsyncOpenAI(api_key=self._api_key)
                logger.info(f"Initialized OpenAI client for model: {self._model_name}")
            except ImportError:
                raise ImportError(
                    "openai is required for OpenAIEmbeddingProvider. "
                    "Install with: pip install openai"
                )
        return self._client

    async def embed_text(self, text: str) -> list[float]:
        """Embed a single text string."""
        client = self._get_client()
        response = await client.embeddings.create(
            model=self._model_name,
            input=text,
        )
        return response.data[0].embedding

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts in a batch."""
        if not texts:
            return []

        client = self._get_client()
        response = await client.embeddings.create(
            model=self._model_name,
            input=texts,
        )
        # Sort by index to maintain order
        sorted_data = sorted(response.data, key=lambda x: x.index)
        return [item.embedding for item in sorted_data]


class SentenceTransformerProvider(EmbeddingProvider):
    """
    Sentence-transformers based embedding provider.

    Uses the sentence-transformers library for local embedding.
    Good balance of quality and control.
    """

    MODELS = {
        "all-MiniLM-L6-v2": 384,
        "all-mpnet-base-v2": 768,
        "multi-qa-MiniLM-L6-cos-v1": 384,
        "paraphrase-multilingual-MiniLM-L12-v2": 384,
    }

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        """
        Initialize sentence-transformers provider.

        Args:
            model_name: Name of the sentence-transformers model
        """
        if model_name not in self.MODELS:
            raise ValueError(
                f"Unknown model: {model_name}. Available: {list(self.MODELS.keys())}"
            )

        self._model_name = model_name
        self._dimension = self.MODELS[model_name]
        self._model = None

    @property
    def name(self) -> str:
        return "sentence-transformers"

    @property
    def dimension(self) -> int:
        return self._dimension

    @property
    def model_name(self) -> str:
        return self._model_name

    def _get_model(self):
        """Lazy-load the embedding model."""
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer

                self._model = SentenceTransformer(self._model_name)
                logger.info(f"Loaded sentence-transformers model: {self._model_name}")
            except ImportError:
                raise ImportError(
                    "sentence-transformers is required for SentenceTransformerProvider. "
                    "Install with: pip install sentence-transformers"
                )
        return self._model

    async def embed_text(self, text: str) -> list[float]:
        """Embed a single text string."""
        model = self._get_model()
        embedding = model.encode(text, convert_to_numpy=True)
        return embedding.tolist()

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts in a batch."""
        if not texts:
            return []

        model = self._get_model()
        embeddings = model.encode(texts, convert_to_numpy=True)
        return [emb.tolist() for emb in embeddings]


def create_embedding_provider(
    provider: str = "fastembed",
    model_name: Optional[str] = None,
    **kwargs,
) -> EmbeddingProvider:
    """
    Factory function to create an embedding provider.

    Args:
        provider: Provider type ("fastembed", "openai", "sentence-transformers")
        model_name: Model name (uses default if not provided)
        **kwargs: Additional arguments passed to the provider

    Returns:
        Configured EmbeddingProvider instance
    """
    providers = {
        "fastembed": (FastEmbedProvider, "BAAI/bge-small-en-v1.5"),
        "openai": (OpenAIEmbeddingProvider, "text-embedding-3-small"),
        "sentence-transformers": (SentenceTransformerProvider, "all-MiniLM-L6-v2"),
    }

    if provider not in providers:
        raise ValueError(
            f"Unknown provider: {provider}. Available: {list(providers.keys())}"
        )

    provider_class, default_model = providers[provider]
    model = model_name or default_model

    return provider_class(model_name=model, **kwargs)
