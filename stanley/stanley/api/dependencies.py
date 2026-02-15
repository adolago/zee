"""
Stanley API Dependencies
========================

Dependency injection container for the Stanley API, providing
centralized access to analyzers, data managers, and other services.

This module implements the dependency injection pattern to:
- Centralize service initialization
- Enable easier testing with mock dependencies
- Provide type-safe access to services throughout the API

Usage:
    from stanley.api.dependencies import get_container, Container

    @app.get("/api/data")
    async def get_data(container: Container = Depends(get_container)):
        data = await container.data_manager.get_stock_data(...)
        return data
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from ..data.data_manager import DataManager
    from ..analytics.money_flow import MoneyFlowAnalyzer
    from ..analytics.institutional import InstitutionalAnalyzer
    from ..portfolio import PortfolioAnalyzer
    from ..research import ResearchAnalyzer
    from ..commodities import CommoditiesAnalyzer
    from ..options import OptionsAnalyzer
    from ..etf import ETFAnalyzer
    from ..notes import NoteManager
    from ..accounting import (
        AccountingAnalyzer,
        EarningsQualityAnalyzer,
        RedFlagScorer,
        AnomalyAggregator,
    )
    from ..signals import SignalGenerator, SignalBacktester, PerformanceTracker

logger = logging.getLogger(__name__)


@dataclass
class Container:
    """
    Dependency injection container for Stanley services.

    This container holds references to all analyzer and service instances,
    providing a single point of access for dependency injection.

    Attributes:
        data_manager: DataManager for market data access
        money_flow_analyzer: Money flow analysis service
        institutional_analyzer: Institutional holdings analyzer
        portfolio_analyzer: Portfolio analytics service
        research_analyzer: Research and valuation analyzer
        commodities_analyzer: Commodities data service
        options_analyzer: Options analytics service
        etf_analyzer: ETF analysis service
        note_manager: Research notes manager
        accounting_analyzer: SEC filings analyzer
        earnings_quality_analyzer: Earnings quality scorer
        red_flag_scorer: Financial red flag detector
        anomaly_aggregator: Anomaly detection aggregator
        signal_generator: Trading signal generator
        signal_backtester: Signal backtesting service
        performance_tracker: Performance tracking service
    """

    # Core data services
    data_manager: Optional[DataManager] = None

    # Analyzers
    money_flow_analyzer: Optional[MoneyFlowAnalyzer] = None
    institutional_analyzer: Optional[InstitutionalAnalyzer] = None
    portfolio_analyzer: Optional[PortfolioAnalyzer] = None
    research_analyzer: Optional[ResearchAnalyzer] = None
    commodities_analyzer: Optional[CommoditiesAnalyzer] = None
    options_analyzer: Optional[OptionsAnalyzer] = None
    etf_analyzer: Optional[ETFAnalyzer] = None

    # Notes and research
    note_manager: Optional[NoteManager] = None

    # Accounting and SEC
    accounting_analyzer: Optional[AccountingAnalyzer] = None
    earnings_quality_analyzer: Optional[EarningsQualityAnalyzer] = None
    red_flag_scorer: Optional[RedFlagScorer] = None
    anomaly_aggregator: Optional[AnomalyAggregator] = None

    # Signals
    signal_generator: Optional[SignalGenerator] = None
    signal_backtester: Optional[SignalBacktester] = None
    performance_tracker: Optional[PerformanceTracker] = None

    # Internal state
    _initialized: bool = field(default=False, repr=False)

    async def initialize(self) -> None:
        """
        Initialize all services.

        This method sets up all analyzers and services, handling
        any initialization errors gracefully with fallback to mock data.
        """
        if self._initialized:
            logger.debug("Container already initialized")
            return

        logger.info("Initializing Stanley API container...")

        # Import here to avoid circular imports
        from ..data.data_manager import DataManager
        from ..analytics.money_flow import MoneyFlowAnalyzer
        from ..analytics.institutional import InstitutionalAnalyzer
        from ..portfolio import PortfolioAnalyzer
        from ..research import ResearchAnalyzer
        from ..commodities import CommoditiesAnalyzer
        from ..options import OptionsAnalyzer
        from ..etf import ETFAnalyzer
        from ..notes import NoteManager
        from ..accounting import (
            AccountingAnalyzer,
            EarningsQualityAnalyzer,
            RedFlagScorer,
            AnomalyAggregator,
            EdgarAdapter,
            FinancialStatements,
        )
        from ..signals import SignalGenerator, SignalBacktester, PerformanceTracker

        # Initialize data manager
        self.data_manager = DataManager(use_mock=False)
        try:
            await self.data_manager.initialize()
        except Exception as e:
            logger.warning(f"Data manager initialization failed, using mock: {e}")
            self.data_manager = DataManager(use_mock=True)
            await self.data_manager.initialize()

        # Initialize analyzers
        self.money_flow_analyzer = MoneyFlowAnalyzer(self.data_manager)
        self.institutional_analyzer = InstitutionalAnalyzer(self.data_manager)
        self.portfolio_analyzer = PortfolioAnalyzer(self.data_manager)
        self.research_analyzer = ResearchAnalyzer(self.data_manager)
        self.commodities_analyzer = CommoditiesAnalyzer(self.data_manager)
        self.options_analyzer = OptionsAnalyzer(self.data_manager)
        self.etf_analyzer = ETFAnalyzer(self.data_manager)

        # Initialize accounting analyzers
        try:
            sec_identity = os.environ.get(
                "SEC_IDENTITY", "stanley-research@example.com"
            )
            edgar_adapter = EdgarAdapter(identity=sec_identity)
            edgar_adapter.initialize()
            financial_statements = FinancialStatements(edgar_adapter=edgar_adapter)

            self.accounting_analyzer = AccountingAnalyzer(edgar_identity=sec_identity)
            self.earnings_quality_analyzer = EarningsQualityAnalyzer(
                financial_statements=financial_statements
            )
            self.red_flag_scorer = RedFlagScorer(edgar_adapter=edgar_adapter)
            self.anomaly_aggregator = AnomalyAggregator(edgar_adapter=edgar_adapter)
            logger.info(
                f"Accounting analyzers initialized with SEC identity: {sec_identity}"
            )
        except Exception as e:
            logger.warning(f"Accounting analyzers initialization failed: {e}")

        # Initialize note manager
        try:
            self.note_manager = NoteManager()
            logger.info("Note manager initialized")
        except Exception as e:
            logger.warning(f"Note manager initialization failed: {e}")

        # Initialize signal generator
        try:
            self.signal_generator = SignalGenerator(
                money_flow_analyzer=self.money_flow_analyzer,
                institutional_analyzer=self.institutional_analyzer,
                research_analyzer=self.research_analyzer,
                portfolio_analyzer=self.portfolio_analyzer,
                data_manager=self.data_manager,
            )
            self.signal_backtester = SignalBacktester(self.data_manager)
            self.performance_tracker = PerformanceTracker(self.data_manager)
            logger.info("Signal generator initialized")
        except Exception as e:
            logger.warning(f"Signal generator initialization failed: {e}")

        self._initialized = True
        logger.info("Stanley API container initialized successfully")

    async def close(self) -> None:
        """Close all service connections."""
        if self.data_manager:
            try:
                await self.data_manager.close()
            except Exception as e:
                logger.error(f"Error closing data manager: {e}")

        self._initialized = False
        logger.info("Stanley API container closed")

    def reset(self) -> None:
        """Reset the container to uninitialized state."""
        self.data_manager = None
        self.money_flow_analyzer = None
        self.institutional_analyzer = None
        self.portfolio_analyzer = None
        self.research_analyzer = None
        self.commodities_analyzer = None
        self.options_analyzer = None
        self.etf_analyzer = None
        self.note_manager = None
        self.accounting_analyzer = None
        self.earnings_quality_analyzer = None
        self.red_flag_scorer = None
        self.anomaly_aggregator = None
        self.signal_generator = None
        self.signal_backtester = None
        self.performance_tracker = None
        self._initialized = False

    @property
    def is_initialized(self) -> bool:
        """Check if container is initialized."""
        return self._initialized

    @property
    def stanley(self) -> Container:
        """
        Lazy accessor that ensures container is initialized.

        For backward compatibility with code that expects a 'stanley' attribute.
        """
        return self


# Global container instance
_container: Optional[Container] = None


def get_container() -> Container:
    """
    Get or create the global container instance.

    Returns:
        The global Container instance

    Note:
        The container must be initialized via `container.initialize()`
        during application startup.
    """
    global _container
    if _container is None:
        _container = Container()
    return _container


def reset_container() -> None:
    """
    Reset the global container.

    Primarily used for testing to ensure a clean state.
    """
    global _container
    if _container is not None:
        _container.reset()
    _container = None


async def init_container() -> Container:
    """
    Initialize and return the global container.

    Convenience function for application startup.
    """
    container = get_container()
    await container.initialize()
    return container


# =============================================================================
# Individual Dependency Getters
# =============================================================================


def get_note_manager():
    """
    Get NoteManager from the container.

    FastAPI dependency for injecting NoteManager into route handlers.

    Returns:
        NoteManager instance or None if not initialized

    Raises:
        HTTPException: If note manager is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.note_manager is None:
        raise HTTPException(status_code=503, detail="Note manager not initialized")
    return container.note_manager


def get_data_manager():
    """
    Get DataManager from the container.

    FastAPI dependency for injecting DataManager into route handlers.

    Returns:
        DataManager instance or None if not initialized

    Raises:
        HTTPException: If data manager is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.data_manager is None:
        raise HTTPException(status_code=503, detail="Data manager not initialized")
    return container.data_manager


def get_money_flow_analyzer():
    """
    Get MoneyFlowAnalyzer from the container.

    Returns:
        MoneyFlowAnalyzer instance or None if not initialized

    Raises:
        HTTPException: If analyzer is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.money_flow_analyzer is None:
        raise HTTPException(
            status_code=503, detail="Money flow analyzer not initialized"
        )
    return container.money_flow_analyzer


def get_institutional_analyzer():
    """
    Get InstitutionalAnalyzer from the container.

    Returns:
        InstitutionalAnalyzer instance or None if not initialized

    Raises:
        HTTPException: If analyzer is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.institutional_analyzer is None:
        raise HTTPException(
            status_code=503, detail="Institutional analyzer not initialized"
        )
    return container.institutional_analyzer


def get_portfolio_analyzer():
    """
    Get PortfolioAnalyzer from the container.

    Returns:
        PortfolioAnalyzer instance or None if not initialized

    Raises:
        HTTPException: If analyzer is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.portfolio_analyzer is None:
        raise HTTPException(
            status_code=503, detail="Portfolio analyzer not initialized"
        )
    return container.portfolio_analyzer


def get_research_analyzer():
    """
    Get ResearchAnalyzer from the container.

    Returns:
        ResearchAnalyzer instance or None if not initialized

    Raises:
        HTTPException: If analyzer is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.research_analyzer is None:
        raise HTTPException(status_code=503, detail="Research analyzer not initialized")
    return container.research_analyzer


def get_commodities_analyzer():
    """
    Get CommoditiesAnalyzer from the container.

    Returns:
        CommoditiesAnalyzer instance or None if not initialized

    Raises:
        HTTPException: If analyzer is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.commodities_analyzer is None:
        raise HTTPException(
            status_code=503, detail="Commodities analyzer not initialized"
        )
    return container.commodities_analyzer


def get_options_analyzer():
    """
    Get OptionsAnalyzer from the container.

    Returns:
        OptionsAnalyzer instance or None if not initialized

    Raises:
        HTTPException: If analyzer is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.options_analyzer is None:
        raise HTTPException(status_code=503, detail="Options analyzer not initialized")
    return container.options_analyzer


def get_etf_analyzer():
    """
    Get ETFAnalyzer from the container.

    Returns:
        ETFAnalyzer instance or None if not initialized

    Raises:
        HTTPException: If analyzer is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.etf_analyzer is None:
        raise HTTPException(status_code=503, detail="ETF analyzer not initialized")
    return container.etf_analyzer


def get_accounting_analyzer():
    """
    Get AccountingAnalyzer from the container.

    Returns:
        AccountingAnalyzer instance or None if not initialized

    Raises:
        HTTPException: If analyzer is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.accounting_analyzer is None:
        raise HTTPException(
            status_code=503, detail="Accounting analyzer not initialized"
        )
    return container.accounting_analyzer


def get_signal_generator():
    """
    Get SignalGenerator from the container.

    Returns:
        SignalGenerator instance or None if not initialized

    Raises:
        HTTPException: If signal generator is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.signal_generator is None:
        raise HTTPException(status_code=503, detail="Signal generator not initialized")
    return container.signal_generator


def get_signal_backtester():
    """
    Get SignalBacktester from the container.

    Returns:
        SignalBacktester instance or None if not initialized

    Raises:
        HTTPException: If backtester is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.signal_backtester is None:
        raise HTTPException(status_code=503, detail="Signal backtester not initialized")
    return container.signal_backtester


def get_performance_tracker():
    """
    Get PerformanceTracker from the container.

    Returns:
        PerformanceTracker instance or None if not initialized

    Raises:
        HTTPException: If tracker is not available
    """
    from fastapi import HTTPException

    container = get_container()
    if container.performance_tracker is None:
        raise HTTPException(
            status_code=503, detail="Performance tracker not initialized"
        )
    return container.performance_tracker


# =============================================================================
# Redis Dependency
# =============================================================================


def get_redis():
    """
    Get Redis connection if configured.

    Returns:
        Redis connection or None if not configured
    """
    try:
        import redis

        redis_url = os.environ.get("STANLEY_REDIS_URL")
        if redis_url:
            return redis.from_url(redis_url, decode_responses=True)
    except ImportError:
        logger.debug("Redis not available")
    return None


__all__ = [
    # Container
    "Container",
    "get_container",
    "reset_container",
    "init_container",
    # Individual dependencies
    "get_note_manager",
    "get_data_manager",
    "get_money_flow_analyzer",
    "get_institutional_analyzer",
    "get_portfolio_analyzer",
    "get_research_analyzer",
    "get_commodities_analyzer",
    "get_options_analyzer",
    "get_etf_analyzer",
    "get_accounting_analyzer",
    "get_signal_generator",
    "get_signal_backtester",
    "get_performance_tracker",
    "get_redis",
]
