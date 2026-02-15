"""
Plugin Interface Definitions

Provides abstract base classes and protocols for all Stanley plugins.
Uses Python's Protocol-based structural typing for flexibility.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum, auto
from typing import (
    Any,
    Callable,
    Dict,
    Generic,
    List,
    Optional,
    Protocol,
    Set,
    TypeVar,
    Union,
    runtime_checkable,
)

import pandas as pd

# Type variables for generic plugin types
T = TypeVar("T")
ConfigT = TypeVar("ConfigT", bound="PluginConfig")


class PluginType(Enum):
    """Types of plugins supported by Stanley."""

    INDICATOR = auto()  # Technical/fundamental indicators
    DATA_SOURCE = auto()  # Data providers (APIs, files, etc.)
    ANALYZER = auto()  # Analysis modules
    VIEW = auto()  # Visualization/output plugins
    TRANSFORMER = auto()  # Data transformation plugins
    SIGNAL = auto()  # Trading signal generators
    RISK = auto()  # Risk assessment plugins
    REPORT = auto()  # Report generation plugins


class PluginState(Enum):
    """Plugin lifecycle states."""

    UNLOADED = auto()  # Plugin not loaded
    LOADED = auto()  # Plugin loaded but not initialized
    INITIALIZING = auto()  # Plugin being initialized
    READY = auto()  # Plugin ready for use
    RUNNING = auto()  # Plugin actively processing
    PAUSED = auto()  # Plugin paused
    ERROR = auto()  # Plugin in error state
    STOPPING = auto()  # Plugin shutting down
    DISABLED = auto()  # Plugin disabled by user


class PluginCapability(Enum):
    """Capabilities that plugins can declare."""

    # Data capabilities
    REAL_TIME_DATA = auto()
    HISTORICAL_DATA = auto()
    BATCH_PROCESSING = auto()
    STREAMING = auto()

    # Computation capabilities
    ASYNC_EXECUTION = auto()
    PARALLEL_PROCESSING = auto()
    GPU_ACCELERATION = auto()

    # Integration capabilities
    API_ACCESS = auto()
    FILE_SYSTEM = auto()
    NETWORK = auto()
    DATABASE = auto()

    # Output capabilities
    CHART_OUTPUT = auto()
    TABLE_OUTPUT = auto()
    ALERT_OUTPUT = auto()
    EXPORT_OUTPUT = auto()


@dataclass(frozen=True)
class PluginDependency:
    """Defines a plugin dependency."""

    name: str  # Dependency name
    version_spec: str = "*"  # Version specification (e.g., ">=1.0.0,<2.0.0")
    optional: bool = False  # Is this dependency optional?
    plugin_type: Optional[PluginType] = None  # Type of plugin dependency


@dataclass
class PluginMetadata:
    """Plugin metadata for identification and management."""

    name: str  # Unique plugin name
    version: str  # Semantic version
    description: str = ""  # Human-readable description
    author: str = ""  # Author name/email
    license: str = "MIT"  # License identifier
    homepage: str = ""  # Project URL
    repository: str = ""  # Source repository URL
    plugin_type: PluginType = PluginType.INDICATOR  # Type of plugin
    capabilities: Set[PluginCapability] = field(default_factory=set)
    dependencies: List[PluginDependency] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)  # Searchable tags
    min_stanley_version: str = "0.1.0"  # Minimum Stanley version
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


@dataclass
class PluginConfig:
    """Base configuration for plugins."""

    enabled: bool = True
    priority: int = 100  # Execution priority (lower = higher priority)
    timeout_seconds: float = 30.0  # Max execution time
    max_memory_mb: int = 512  # Memory limit
    cache_results: bool = True  # Cache computation results
    log_level: str = "INFO"  # Plugin log level
    custom_settings: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PluginContext:
    """Runtime context passed to plugins during execution."""

    request_id: str  # Unique request identifier
    user_id: Optional[str] = None  # User making the request
    timestamp: datetime = field(default_factory=datetime.now)
    config: PluginConfig = field(default_factory=PluginConfig)
    metadata: Dict[str, Any] = field(default_factory=dict)
    parent_plugin: Optional[str] = None  # Parent plugin if chained
    correlation_id: Optional[str] = None  # For request tracing


# =============================================================================
# Result Classes
# =============================================================================


@dataclass
class PluginResult:
    """Base class for plugin results."""

    success: bool
    data: Any = None
    error: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    execution_time_ms: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class IndicatorResult(PluginResult):
    """Result from indicator plugin execution."""

    indicator_name: str = ""
    symbol: str = ""
    timeframe: str = ""
    values: Optional[pd.Series] = None
    signals: Optional[pd.Series] = None  # Buy/sell signals if applicable
    upper_band: Optional[pd.Series] = None  # For band indicators
    lower_band: Optional[pd.Series] = None


@dataclass
class DataSourceResult(PluginResult):
    """Result from data source plugin execution."""

    source_name: str = ""
    data_type: str = ""  # "price", "fundamental", "alternative"
    dataframe: Optional[pd.DataFrame] = None
    schema: Optional[Dict[str, str]] = None  # Column types
    freshness: Optional[datetime] = None  # Data timestamp
    rate_limit_remaining: Optional[int] = None


@dataclass
class AnalysisResult(PluginResult):
    """Result from analyzer plugin execution."""

    analyzer_name: str = ""
    analysis_type: str = ""  # "money_flow", "institutional", etc.
    summary: Dict[str, Any] = field(default_factory=dict)
    details: Dict[str, Any] = field(default_factory=dict)
    recommendations: List[str] = field(default_factory=list)
    confidence_score: float = 0.0


@dataclass
class ViewResult(PluginResult):
    """Result from view plugin execution."""

    view_name: str = ""
    content_type: str = ""  # "html", "json", "chart", "table"
    content: Any = None
    assets: Dict[str, bytes] = field(default_factory=dict)  # Associated files


# =============================================================================
# Plugin Protocols (Structural Typing)
# =============================================================================


@runtime_checkable
class PluginProtocol(Protocol):
    """Protocol that all plugins must implement."""

    @property
    def metadata(self) -> PluginMetadata:
        """Return plugin metadata."""
        ...

    def initialize(self, config: PluginConfig) -> None:
        """Initialize the plugin with configuration."""
        ...

    def shutdown(self) -> None:
        """Cleanup resources and shutdown."""
        ...

    def health_check(self) -> bool:
        """Check if plugin is healthy."""
        ...


# =============================================================================
# Abstract Base Classes
# =============================================================================


class BasePlugin(ABC):
    """
    Abstract base class for all Stanley plugins.

    Provides common functionality and lifecycle management.
    All plugins must inherit from this class.
    """

    # Class-level metadata (override in subclasses)
    name: str = "base_plugin"
    version: str = "0.0.0"
    description: str = "Base plugin"
    plugin_type: PluginType = PluginType.INDICATOR

    def __init__(self):
        """Initialize the plugin."""
        self._state: PluginState = PluginState.UNLOADED
        self._config: Optional[PluginConfig] = None
        self._error_message: Optional[str] = None
        self._hooks: Dict[str, List[Callable]] = {}

    @property
    def metadata(self) -> PluginMetadata:
        """Return plugin metadata."""
        return PluginMetadata(
            name=self.name,
            version=self.version,
            description=self.description,
            plugin_type=self.plugin_type,
            capabilities=self._get_capabilities(),
            dependencies=self._get_dependencies(),
        )

    @property
    def state(self) -> PluginState:
        """Return current plugin state."""
        return self._state

    @property
    def config(self) -> Optional[PluginConfig]:
        """Return current configuration."""
        return self._config

    def _get_capabilities(self) -> Set[PluginCapability]:
        """Override to declare plugin capabilities."""
        return set()

    def _get_dependencies(self) -> List[PluginDependency]:
        """Override to declare plugin dependencies."""
        return []

    def initialize(self, config: Optional[PluginConfig] = None) -> None:
        """
        Initialize the plugin with configuration.

        Args:
            config: Plugin configuration. Uses defaults if not provided.
        """
        self._state = PluginState.INITIALIZING
        try:
            self._config = config or PluginConfig()
            self._on_initialize()
            self._state = PluginState.READY
        except Exception as e:
            self._state = PluginState.ERROR
            self._error_message = str(e)
            raise

    def shutdown(self) -> None:
        """Cleanup resources and shutdown the plugin."""
        self._state = PluginState.STOPPING
        try:
            self._on_shutdown()
            self._state = PluginState.UNLOADED
        except Exception as e:
            self._state = PluginState.ERROR
            self._error_message = str(e)
            raise

    def health_check(self) -> bool:
        """
        Check if the plugin is healthy and ready to process.

        Returns:
            True if healthy, False otherwise
        """
        return self._state == PluginState.READY

    def enable(self) -> None:
        """Enable the plugin."""
        if self._state == PluginState.DISABLED:
            self._state = PluginState.READY

    def disable(self) -> None:
        """Disable the plugin."""
        if self._state in (PluginState.READY, PluginState.RUNNING):
            self._state = PluginState.DISABLED

    # Hook system for extensibility
    def register_hook(self, event: str, callback: Callable) -> None:
        """Register a callback for an event."""
        if event not in self._hooks:
            self._hooks[event] = []
        self._hooks[event].append(callback)

    def _trigger_hook(self, event: str, *args, **kwargs) -> List[Any]:
        """Trigger all callbacks for an event."""
        results = []
        for callback in self._hooks.get(event, []):
            try:
                results.append(callback(*args, **kwargs))
            except Exception:
                pass  # Don't let hooks break execution
        return results

    # Lifecycle hooks for subclasses
    def _on_initialize(self) -> None:
        """Override for custom initialization logic."""
        pass

    def _on_shutdown(self) -> None:
        """Override for custom shutdown logic."""
        pass

    @abstractmethod
    def execute(self, context: PluginContext, **kwargs) -> PluginResult:
        """
        Execute the plugin's main functionality.

        Args:
            context: Execution context with request info
            **kwargs: Plugin-specific arguments

        Returns:
            PluginResult with execution outcome
        """
        ...

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(name={self.name}, version={self.version}, state={self.state.name})>"


class IndicatorPlugin(BasePlugin):
    """
    Base class for technical and fundamental indicator plugins.

    Indicators calculate derived values from price/volume/fundamental data.

    Example:
        class SMAIndicator(IndicatorPlugin):
            name = "sma"
            version = "1.0.0"
            description = "Simple Moving Average"

            def __init__(self, period: int = 20):
                super().__init__()
                self.period = period

            def calculate(self, data: pd.DataFrame) -> IndicatorResult:
                values = data['close'].rolling(self.period).mean()
                return IndicatorResult(
                    success=True,
                    indicator_name=self.name,
                    values=values,
                )
    """

    plugin_type = PluginType.INDICATOR

    # Indicator configuration
    input_columns: List[str] = ["close"]  # Required input columns
    output_name: str = ""  # Output column name
    is_overlay: bool = True  # Display on price chart?

    @abstractmethod
    def calculate(
        self,
        data: pd.DataFrame,
        **params,
    ) -> IndicatorResult:
        """
        Calculate indicator values.

        Args:
            data: DataFrame with OHLCV data
            **params: Indicator-specific parameters

        Returns:
            IndicatorResult with calculated values
        """
        ...

    def execute(self, context: PluginContext, **kwargs) -> IndicatorResult:
        """Execute the indicator calculation."""
        data = kwargs.get("data")
        if data is None:
            return IndicatorResult(
                success=False,
                error="No data provided for indicator calculation",
            )
        return self.calculate(data, **kwargs)

    def validate_input(self, data: pd.DataFrame) -> bool:
        """Validate that required columns exist."""
        return all(col in data.columns for col in self.input_columns)


class DataSourcePlugin(BasePlugin):
    """
    Base class for data source plugins.

    Data sources provide access to external data providers.

    Example:
        class AlphaVantageSource(DataSourcePlugin):
            name = "alpha_vantage"
            version = "1.0.0"

            async def fetch(self, symbol: str, **kwargs) -> DataSourceResult:
                # Fetch data from Alpha Vantage API
                data = await self._call_api(symbol)
                return DataSourceResult(
                    success=True,
                    source_name=self.name,
                    dataframe=data,
                )
    """

    plugin_type = PluginType.DATA_SOURCE

    # Data source configuration
    base_url: str = ""
    requires_api_key: bool = False
    rate_limit_per_minute: int = 60
    supported_symbols: Optional[List[str]] = None
    data_types: List[str] = ["price"]  # "price", "fundamental", "alternative"

    def _get_capabilities(self) -> Set[PluginCapability]:
        return {PluginCapability.API_ACCESS, PluginCapability.NETWORK}

    @abstractmethod
    async def fetch(
        self,
        symbol: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        **params,
    ) -> DataSourceResult:
        """
        Fetch data from the source.

        Args:
            symbol: Security symbol
            start_date: Start date for historical data
            end_date: End date for historical data
            **params: Source-specific parameters

        Returns:
            DataSourceResult with fetched data
        """
        ...

    def execute(self, context: PluginContext, **kwargs) -> DataSourceResult:
        """Execute synchronous data fetch (wraps async)."""
        import asyncio

        symbol = kwargs.get("symbol")
        if not symbol:
            return DataSourceResult(
                success=False,
                error="No symbol provided",
            )

        # Run async fetch in sync context
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(self.fetch(symbol, **kwargs))

    async def health_check_async(self) -> bool:
        """Async health check for data source connectivity."""
        return True


class AnalyzerPlugin(BasePlugin):
    """
    Base class for analysis plugins.

    Analyzers perform complex analysis on market data.

    Example:
        class MoneyFlowPlugin(AnalyzerPlugin):
            name = "custom_money_flow"
            version = "1.0.0"

            def analyze(
                self,
                data: pd.DataFrame,
                **kwargs,
            ) -> AnalysisResult:
                # Perform money flow analysis
                score = self._calculate_flow_score(data)
                return AnalysisResult(
                    success=True,
                    analyzer_name=self.name,
                    summary={"flow_score": score},
                    confidence_score=0.85,
                )
    """

    plugin_type = PluginType.ANALYZER

    # Analyzer configuration
    analysis_type: str = "generic"
    required_data: List[str] = ["price"]  # Required data types
    output_format: str = "dict"  # "dict", "dataframe", "report"

    @abstractmethod
    def analyze(
        self,
        data: Union[pd.DataFrame, Dict[str, pd.DataFrame]],
        **params,
    ) -> AnalysisResult:
        """
        Perform analysis on the data.

        Args:
            data: Input data (DataFrame or dict of DataFrames)
            **params: Analysis-specific parameters

        Returns:
            AnalysisResult with analysis output
        """
        ...

    def execute(self, context: PluginContext, **kwargs) -> AnalysisResult:
        """Execute the analysis."""
        data = kwargs.get("data")
        if data is None:
            return AnalysisResult(
                success=False,
                error="No data provided for analysis",
            )
        return self.analyze(data, **kwargs)


class ViewPlugin(BasePlugin):
    """
    Base class for view/visualization plugins.

    Views generate visual outputs like charts, tables, and reports.

    Example:
        class CandlestickChartPlugin(ViewPlugin):
            name = "candlestick_chart"
            version = "1.0.0"

            def render(self, data: pd.DataFrame, **kwargs) -> ViewResult:
                chart = self._create_candlestick(data)
                return ViewResult(
                    success=True,
                    view_name=self.name,
                    content_type="html",
                    content=chart.to_html(),
                )
    """

    plugin_type = PluginType.VIEW

    # View configuration
    output_format: str = "html"  # "html", "json", "image", "pdf"
    supports_interactive: bool = False
    supports_export: bool = True

    def _get_capabilities(self) -> Set[PluginCapability]:
        return {PluginCapability.CHART_OUTPUT, PluginCapability.EXPORT_OUTPUT}

    @abstractmethod
    def render(
        self,
        data: Union[pd.DataFrame, Dict[str, Any]],
        **params,
    ) -> ViewResult:
        """
        Render the visualization.

        Args:
            data: Input data for visualization
            **params: View-specific parameters

        Returns:
            ViewResult with rendered content
        """
        ...

    def execute(self, context: PluginContext, **kwargs) -> ViewResult:
        """Execute the rendering."""
        data = kwargs.get("data")
        if data is None:
            return ViewResult(
                success=False,
                error="No data provided for rendering",
            )
        return self.render(data, **kwargs)

    def export(
        self,
        result: ViewResult,
        format: str = "png",
        path: Optional[str] = None,
    ) -> bytes:
        """Export the rendered view to a file format."""
        raise NotImplementedError("Export not implemented for this view")
