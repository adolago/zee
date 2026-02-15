"""
Stanley Plugin System

A comprehensive plugin architecture for extending Stanley's functionality
with custom indicators, data sources, analyzers, and views.

Architecture Overview:
---------------------
1. Plugin Base Classes (interfaces.py)
   - BasePlugin: Core interface all plugins implement
   - IndicatorPlugin: Custom technical/fundamental indicators
   - DataSourcePlugin: Custom data providers
   - AnalyzerPlugin: Custom analysis modules
   - ViewPlugin: Custom visualization/output plugins

2. Plugin Manager (manager.py)
   - Plugin discovery and registration
   - Lifecycle management (load, enable, disable, unload)
   - Dependency resolution
   - Hot reload support

3. Plugin Configuration (config.py)
   - Plugin-specific settings
   - Schema validation
   - Environment-based configuration

4. Plugin Security (security.py)
   - Sandboxed execution
   - Permission system
   - Resource limits

5. Plugin Marketplace (marketplace.py)
   - Plugin registry and discovery
   - Version management
   - Installation/update mechanism

Usage:
------
    from stanley.plugins import PluginManager, IndicatorPlugin

    # Create a custom indicator
    class MyIndicator(IndicatorPlugin):
        name = "my_indicator"
        version = "1.0.0"

        def calculate(self, data: pd.DataFrame) -> pd.Series:
            return data['close'].rolling(20).mean()

    # Register with the plugin manager
    manager = PluginManager()
    manager.register(MyIndicator)

    # Or auto-discover plugins
    manager.discover_plugins()
"""

from .interfaces import (
    # Base classes
    BasePlugin,
    PluginType,
    PluginMetadata,
    PluginCapability,
    PluginDependency,
    PluginState,
    # Plugin types
    IndicatorPlugin,
    DataSourcePlugin,
    AnalyzerPlugin,
    ViewPlugin,
    # Results and contexts
    IndicatorResult,
    DataSourceResult,
    AnalysisResult,
    ViewResult,
    PluginContext,
)
from .manager import (
    PluginManager,
    PluginRegistry,
    PluginLoader,
    PluginError,
    PluginLoadError,
    PluginNotFoundError,
    PluginDependencyError,
)

# NOTE: The following modules are planned but not yet implemented:
# - config.py: Plugin-specific settings and schema validation
# - security.py: Sandboxed execution and permission system
# - marketplace.py: Plugin registry and discovery
# - hot_reload.py: Hot reload support

__all__ = [
    # Base classes
    "BasePlugin",
    "PluginType",
    "PluginMetadata",
    "PluginCapability",
    "PluginDependency",
    "PluginState",
    # Plugin types
    "IndicatorPlugin",
    "DataSourcePlugin",
    "AnalyzerPlugin",
    "ViewPlugin",
    # Results and contexts
    "IndicatorResult",
    "DataSourceResult",
    "AnalysisResult",
    "ViewResult",
    "PluginContext",
    # Manager
    "PluginManager",
    "PluginRegistry",
    "PluginLoader",
    "PluginError",
    "PluginLoadError",
    "PluginNotFoundError",
    "PluginDependencyError",
]
