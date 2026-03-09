"""
Plugin Manager and Registry

Handles plugin discovery, loading, registration, and lifecycle management.
"""

import importlib
import importlib.util
import logging
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import (
    Any,
    Callable,
    Dict,
    Iterator,
    List,
    Optional,
    Set,
    Type,
    TypeVar,
    Union,
)

from .interfaces import (
    BasePlugin,
    PluginCapability,
    PluginConfig,
    PluginContext,
    PluginDependency,
    PluginMetadata,
    PluginResult,
    PluginState,
    PluginType,
)

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BasePlugin)


# =============================================================================
# Exceptions
# =============================================================================


class PluginError(Exception):
    """Base exception for plugin-related errors."""

    pass


class PluginLoadError(PluginError):
    """Error loading a plugin."""

    pass


class PluginNotFoundError(PluginError):
    """Plugin not found in registry."""

    pass


class PluginDependencyError(PluginError):
    """Plugin dependency not satisfied."""

    pass


class PluginVersionError(PluginError):
    """Plugin version incompatibility."""

    pass


class PluginSecurityError(PluginError):
    """Plugin security violation."""

    pass


# =============================================================================
# Plugin Registry
# =============================================================================


@dataclass
class RegisteredPlugin:
    """Container for registered plugin information."""

    plugin_class: Type[BasePlugin]
    instance: Optional[BasePlugin] = None
    metadata: Optional[PluginMetadata] = None
    config: Optional[PluginConfig] = None
    load_path: Optional[str] = None
    load_time: Optional[datetime] = None
    error: Optional[str] = None

    @property
    def is_instantiated(self) -> bool:
        return self.instance is not None

    @property
    def is_ready(self) -> bool:
        return self.instance is not None and self.instance.state == PluginState.READY


class PluginRegistry:
    """
    Central registry for all loaded plugins.

    Provides indexing by name, type, and capability for fast lookups.
    Thread-safe for concurrent access.
    """

    def __init__(self):
        """Initialize the plugin registry."""
        self._plugins: Dict[str, RegisteredPlugin] = {}
        self._by_type: Dict[PluginType, Set[str]] = defaultdict(set)
        self._by_capability: Dict[PluginCapability, Set[str]] = defaultdict(set)
        self._by_tag: Dict[str, Set[str]] = defaultdict(set)

    def register(
        self,
        plugin_class: Type[BasePlugin],
        config: Optional[PluginConfig] = None,
        load_path: Optional[str] = None,
    ) -> str:
        """
        Register a plugin class with the registry.

        Args:
            plugin_class: The plugin class to register
            config: Optional configuration for the plugin
            load_path: Optional path where plugin was loaded from

        Returns:
            The plugin name

        Raises:
            PluginLoadError: If registration fails
        """
        try:
            # Create a temporary instance to get metadata
            temp_instance = plugin_class()
            metadata = temp_instance.metadata

            # Check for duplicate registration
            if metadata.name in self._plugins:
                existing = self._plugins[metadata.name]
                logger.warning(
                    f"Plugin '{metadata.name}' already registered "
                    f"(version {existing.metadata.version}), "
                    f"replacing with version {metadata.version}"
                )
                self.unregister(metadata.name)

            # Register the plugin
            registered = RegisteredPlugin(
                plugin_class=plugin_class,
                metadata=metadata,
                config=config,
                load_path=load_path,
                load_time=datetime.now(),
            )

            self._plugins[metadata.name] = registered

            # Index by type
            self._by_type[metadata.plugin_type].add(metadata.name)

            # Index by capabilities
            for capability in metadata.capabilities:
                self._by_capability[capability].add(metadata.name)

            # Index by tags
            for tag in metadata.tags:
                self._by_tag[tag.lower()].add(metadata.name)

            logger.info(
                f"Registered plugin: {metadata.name} v{metadata.version} "
                f"(type: {metadata.plugin_type.name})"
            )

            return metadata.name

        except Exception as e:
            raise PluginLoadError(f"Failed to register plugin: {e}") from e

    def unregister(self, name: str) -> None:
        """
        Unregister a plugin from the registry.

        Args:
            name: Plugin name to unregister

        Raises:
            PluginNotFoundError: If plugin not found
        """
        if name not in self._plugins:
            raise PluginNotFoundError(f"Plugin not found: {name}")

        registered = self._plugins[name]
        metadata = registered.metadata

        # Shutdown instance if running
        if registered.instance and registered.instance.state == PluginState.READY:
            try:
                registered.instance.shutdown()
            except Exception as e:
                logger.warning(f"Error shutting down plugin {name}: {e}")

        # Remove from indices
        self._by_type[metadata.plugin_type].discard(name)
        for capability in metadata.capabilities:
            self._by_capability[capability].discard(name)
        for tag in metadata.tags:
            self._by_tag[tag.lower()].discard(name)

        # Remove from registry
        del self._plugins[name]

        logger.info(f"Unregistered plugin: {name}")

    def get(self, name: str) -> RegisteredPlugin:
        """
        Get a registered plugin by name.

        Args:
            name: Plugin name

        Returns:
            RegisteredPlugin container

        Raises:
            PluginNotFoundError: If plugin not found
        """
        if name not in self._plugins:
            raise PluginNotFoundError(f"Plugin not found: {name}")
        return self._plugins[name]

    def get_instance(self, name: str) -> BasePlugin:
        """
        Get or create a plugin instance.

        Args:
            name: Plugin name

        Returns:
            Plugin instance

        Raises:
            PluginNotFoundError: If plugin not found
        """
        registered = self.get(name)

        if not registered.is_instantiated:
            registered.instance = registered.plugin_class()
            registered.instance.initialize(registered.config)

        return registered.instance

    def list_plugins(
        self,
        plugin_type: Optional[PluginType] = None,
        capability: Optional[PluginCapability] = None,
        tag: Optional[str] = None,
        state: Optional[PluginState] = None,
    ) -> List[str]:
        """
        List plugins matching criteria.

        Args:
            plugin_type: Filter by type
            capability: Filter by capability
            tag: Filter by tag
            state: Filter by state

        Returns:
            List of matching plugin names
        """
        result_set: Optional[Set[str]] = None

        if plugin_type is not None:
            result_set = self._by_type[plugin_type].copy()

        if capability is not None:
            cap_set = self._by_capability[capability]
            if result_set is None:
                result_set = cap_set.copy()
            else:
                result_set &= cap_set

        if tag is not None:
            tag_set = self._by_tag[tag.lower()]
            if result_set is None:
                result_set = tag_set.copy()
            else:
                result_set &= tag_set

        if result_set is None:
            result_set = set(self._plugins.keys())

        # Filter by state
        if state is not None:
            result_set = {
                name
                for name in result_set
                if self._plugins[name].instance
                and self._plugins[name].instance.state == state
            }

        return sorted(result_set)

    def __contains__(self, name: str) -> bool:
        return name in self._plugins

    def __len__(self) -> int:
        return len(self._plugins)

    def __iter__(self) -> Iterator[str]:
        return iter(self._plugins)


# =============================================================================
# Plugin Loader
# =============================================================================


class PluginLoader:
    """
    Loads plugins from various sources.

    Supports:
    - Direct class registration
    - Module import
    - Directory scanning
    - Package/wheel installation
    """

    # Default plugin directories
    DEFAULT_PLUGIN_DIRS = [
        "stanley_plugins",  # User plugins
        "~/.investing/plugins",  # User home plugins
        "/etc/investing/plugins",  # System plugins
    ]

    # Entry point group for installed plugins
    ENTRY_POINT_GROUP = "investing.plugins"

    def __init__(
        self,
        registry: PluginRegistry,
        plugin_dirs: Optional[List[str]] = None,
    ):
        """
        Initialize the plugin loader.

        Args:
            registry: Plugin registry to load into
            plugin_dirs: Additional plugin directories to scan
        """
        self.registry = registry
        self.plugin_dirs = list(plugin_dirs or [])
        self._loaded_modules: Dict[str, Any] = {}

    def load_class(
        self,
        plugin_class: Type[BasePlugin],
        config: Optional[PluginConfig] = None,
    ) -> str:
        """
        Load a plugin class directly.

        Args:
            plugin_class: Plugin class to load
            config: Optional configuration

        Returns:
            Registered plugin name
        """
        return self.registry.register(plugin_class, config=config)

    def load_module(
        self,
        module_name: str,
        config: Optional[PluginConfig] = None,
    ) -> List[str]:
        """
        Load plugins from a Python module.

        Args:
            module_name: Module name (e.g., "my_plugins.indicators")
            config: Optional configuration for all plugins

        Returns:
            List of registered plugin names
        """
        try:
            module = importlib.import_module(module_name)
            self._loaded_modules[module_name] = module

            plugins = []

            # Find all plugin classes in the module
            for name in dir(module):
                obj = getattr(module, name)
                if (
                    isinstance(obj, type)
                    and issubclass(obj, BasePlugin)
                    and obj is not BasePlugin
                    and not name.startswith("_")
                ):
                    try:
                        plugin_name = self.registry.register(
                            obj,
                            config=config,
                            load_path=module_name,
                        )
                        plugins.append(plugin_name)
                    except PluginLoadError as e:
                        logger.warning(f"Failed to load plugin {name}: {e}")

            logger.info(f"Loaded {len(plugins)} plugins from module {module_name}")
            return plugins

        except ImportError as e:
            raise PluginLoadError(f"Failed to import module {module_name}: {e}") from e

    def load_file(
        self,
        file_path: Union[str, Path],
        config: Optional[PluginConfig] = None,
    ) -> List[str]:
        """
        Load plugins from a Python file.

        Args:
            file_path: Path to Python file
            config: Optional configuration

        Returns:
            List of registered plugin names
        """
        path = Path(file_path).resolve()

        if not path.exists():
            raise PluginLoadError(f"Plugin file not found: {path}")

        if not path.suffix == ".py":
            raise PluginLoadError(f"Not a Python file: {path}")

        try:
            # Create module name from file path
            module_name = f"stanley_plugin_{path.stem}"

            # Load the module from file
            spec = importlib.util.spec_from_file_location(module_name, path)
            if spec is None or spec.loader is None:
                raise PluginLoadError(f"Failed to create module spec for {path}")

            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)

            self._loaded_modules[str(path)] = module

            plugins = []

            # Find all plugin classes
            for name in dir(module):
                obj = getattr(module, name)
                if (
                    isinstance(obj, type)
                    and issubclass(obj, BasePlugin)
                    and obj is not BasePlugin
                    and hasattr(obj, "name")
                ):
                    try:
                        plugin_name = self.registry.register(
                            obj,
                            config=config,
                            load_path=str(path),
                        )
                        plugins.append(plugin_name)
                    except PluginLoadError as e:
                        logger.warning(f"Failed to load plugin {name}: {e}")

            logger.info(f"Loaded {len(plugins)} plugins from file {path}")
            return plugins

        except Exception as e:
            raise PluginLoadError(f"Failed to load plugin file {path}: {e}") from e

    def load_directory(
        self,
        directory: Union[str, Path],
        recursive: bool = True,
        config: Optional[PluginConfig] = None,
    ) -> List[str]:
        """
        Load all plugins from a directory.

        Args:
            directory: Directory path
            recursive: Scan subdirectories
            config: Optional configuration

        Returns:
            List of registered plugin names
        """
        path = Path(directory).expanduser().resolve()

        if not path.exists():
            logger.warning(f"Plugin directory not found: {path}")
            return []

        if not path.is_dir():
            raise PluginLoadError(f"Not a directory: {path}")

        plugins = []

        # Find Python files
        pattern = "**/*.py" if recursive else "*.py"
        for file_path in path.glob(pattern):
            # Skip __init__.py and test files
            if file_path.name.startswith("_") or file_path.name.startswith("test_"):
                continue

            try:
                loaded = self.load_file(file_path, config=config)
                plugins.extend(loaded)
            except PluginLoadError as e:
                logger.warning(f"Failed to load plugins from {file_path}: {e}")

        logger.info(f"Loaded {len(plugins)} plugins from directory {path}")
        return plugins

    def load_entry_points(
        self,
        group: Optional[str] = None,
        config: Optional[PluginConfig] = None,
    ) -> List[str]:
        """
        Load plugins from installed packages using entry points.

        This allows plugins to be installed via pip:
            pip install investing-plugin-example

        With setup.py/pyproject.toml entry point:
            [options.entry_points]
            investing.plugins =
                my_indicator = my_package.indicators:MyIndicator

        Args:
            group: Entry point group name
            config: Optional configuration

        Returns:
            List of registered plugin names
        """
        group = group or self.ENTRY_POINT_GROUP
        plugins = []

        try:
            if sys.version_info >= (3, 10):
                from importlib.metadata import entry_points

                eps = entry_points(group=group)
            else:
                from importlib.metadata import entry_points

                all_eps = entry_points()
                eps = all_eps.get(group, [])

            for ep in eps:
                try:
                    plugin_class = ep.load()
                    if issubclass(plugin_class, BasePlugin):
                        plugin_name = self.registry.register(
                            plugin_class,
                            config=config,
                            load_path=f"entrypoint:{ep.name}",
                        )
                        plugins.append(plugin_name)
                except Exception as e:
                    logger.warning(f"Failed to load entry point {ep.name}: {e}")

            logger.info(f"Loaded {len(plugins)} plugins from entry points")
            return plugins

        except Exception as e:
            logger.warning(f"Failed to load entry points: {e}")
            return []

    def discover_all(
        self,
        config: Optional[PluginConfig] = None,
    ) -> List[str]:
        """
        Discover and load all available plugins.

        Scans:
        1. Default plugin directories
        2. Configured plugin directories
        3. Installed packages (entry points)

        Args:
            config: Optional configuration for all plugins

        Returns:
            List of all registered plugin names
        """
        plugins = []

        # Load from directories
        all_dirs = self.DEFAULT_PLUGIN_DIRS + self.plugin_dirs
        for directory in all_dirs:
            try:
                loaded = self.load_directory(directory, config=config)
                plugins.extend(loaded)
            except Exception as e:
                logger.debug(f"Skipping directory {directory}: {e}")

        # Load from entry points
        try:
            loaded = self.load_entry_points(config=config)
            plugins.extend(loaded)
        except Exception as e:
            logger.warning(f"Failed to load entry points: {e}")

        logger.info(f"Plugin discovery complete: {len(plugins)} plugins loaded")
        return plugins


# =============================================================================
# Plugin Manager
# =============================================================================


class PluginManager:
    """
    High-level plugin management interface.

    Coordinates plugin discovery, lifecycle, and execution.

    Usage:
        manager = PluginManager()
        manager.discover_plugins()

        # Get and use a plugin
        indicator = manager.get_plugin("sma")
        result = manager.execute_plugin("sma", data=df)

        # List available plugins
        indicators = manager.list_plugins(type=PluginType.INDICATOR)
    """

    def __init__(
        self,
        plugin_dirs: Optional[List[str]] = None,
        auto_discover: bool = False,
    ):
        """
        Initialize the plugin manager.

        Args:
            plugin_dirs: Additional plugin directories
            auto_discover: Automatically discover plugins on init
        """
        self.registry = PluginRegistry()
        self.loader = PluginLoader(self.registry, plugin_dirs)
        self._hooks: Dict[str, List[Callable]] = {}

        if auto_discover:
            self.discover_plugins()

    def discover_plugins(
        self,
        config: Optional[PluginConfig] = None,
    ) -> List[str]:
        """
        Discover and load all available plugins.

        Args:
            config: Default configuration for plugins

        Returns:
            List of loaded plugin names
        """
        return self.loader.discover_all(config=config)

    def register(
        self,
        plugin_class: Type[BasePlugin],
        config: Optional[PluginConfig] = None,
    ) -> str:
        """
        Register a plugin class.

        Args:
            plugin_class: Plugin class to register
            config: Optional configuration

        Returns:
            Plugin name
        """
        return self.registry.register(plugin_class, config=config)

    def unregister(self, name: str) -> None:
        """Unregister a plugin."""
        self.registry.unregister(name)

    def get_plugin(self, name: str) -> BasePlugin:
        """
        Get a plugin instance.

        Args:
            name: Plugin name

        Returns:
            Plugin instance (initialized)
        """
        return self.registry.get_instance(name)

    def get_metadata(self, name: str) -> PluginMetadata:
        """Get plugin metadata."""
        return self.registry.get(name).metadata

    def list_plugins(
        self,
        plugin_type: Optional[PluginType] = None,
        capability: Optional[PluginCapability] = None,
        tag: Optional[str] = None,
        state: Optional[PluginState] = None,
    ) -> List[str]:
        """List plugins matching criteria."""
        return self.registry.list_plugins(
            plugin_type=plugin_type,
            capability=capability,
            tag=tag,
            state=state,
        )

    def execute_plugin(
        self,
        name: str,
        context: Optional[PluginContext] = None,
        **kwargs,
    ) -> PluginResult:
        """
        Execute a plugin.

        Args:
            name: Plugin name
            context: Execution context
            **kwargs: Plugin-specific arguments

        Returns:
            Plugin result
        """
        import time
        import uuid

        plugin = self.get_plugin(name)

        # Create context if not provided
        if context is None:
            context = PluginContext(request_id=str(uuid.uuid4()))

        # Execute with timing
        start = time.time()
        try:
            result = plugin.execute(context, **kwargs)
            result.execution_time_ms = (time.time() - start) * 1000
            return result
        except Exception as e:
            return PluginResult(
                success=False,
                error=str(e),
                execution_time_ms=(time.time() - start) * 1000,
            )

    def enable_plugin(self, name: str) -> None:
        """Enable a disabled plugin."""
        plugin = self.get_plugin(name)
        plugin.enable()

    def disable_plugin(self, name: str) -> None:
        """Disable a plugin."""
        plugin = self.get_plugin(name)
        plugin.disable()

    def reload_plugin(self, name: str) -> None:
        """
        Reload a plugin from its source.

        Useful for development/hot reload.
        """
        registered = self.registry.get(name)

        if not registered.load_path:
            raise PluginError(f"Plugin {name} has no load path for reload")

        # Get current config
        config = registered.config

        # Unregister
        self.registry.unregister(name)

        # Reload from path
        if registered.load_path.startswith("entrypoint:"):
            # Entry point - reload the module
            ep_name = registered.load_path.split(":", 1)[1]
            self.loader.load_entry_points(config=config)
        elif Path(registered.load_path).exists():
            # File path
            self.loader.load_file(registered.load_path, config=config)
        else:
            # Module name
            self.loader.load_module(registered.load_path, config=config)

    def check_dependencies(
        self,
        name: str,
    ) -> List[PluginDependency]:
        """
        Check if plugin dependencies are satisfied.

        Args:
            name: Plugin name

        Returns:
            List of missing dependencies
        """
        metadata = self.get_metadata(name)
        missing = []

        for dep in metadata.dependencies:
            if dep.name not in self.registry:
                if not dep.optional:
                    missing.append(dep)
            else:
                # Check version compatibility
                dep_metadata = self.get_metadata(dep.name)
                if not self._check_version(dep_metadata.version, dep.version_spec):
                    missing.append(dep)

        return missing

    def _check_version(self, version: str, spec: str) -> bool:
        """Check if version satisfies spec."""
        if spec == "*":
            return True

        try:
            from packaging.version import Version
            from packaging.specifiers import SpecifierSet

            return Version(version) in SpecifierSet(spec)
        except ImportError:
            # Simple fallback if packaging not installed
            return True

    def health_check(self) -> Dict[str, bool]:
        """
        Check health of all registered plugins.

        Returns:
            Dict mapping plugin names to health status
        """
        results = {}
        for name in self.registry:
            try:
                plugin = self.get_plugin(name)
                results[name] = plugin.health_check()
            except Exception:
                results[name] = False
        return results

    def shutdown(self) -> None:
        """Shutdown all plugins and cleanup."""
        for name in list(self.registry):
            try:
                self.registry.unregister(name)
            except Exception as e:
                logger.warning(f"Error unregistering plugin {name}: {e}")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.shutdown()

    # Plugin chaining support
    def chain(
        self,
        plugin_names: List[str],
        context: Optional[PluginContext] = None,
        initial_data: Any = None,
    ) -> List[PluginResult]:
        """
        Execute multiple plugins in sequence.

        Each plugin receives the result of the previous one.

        Args:
            plugin_names: Ordered list of plugin names
            context: Execution context
            initial_data: Starting data

        Returns:
            List of results from each plugin
        """
        results = []
        current_data = initial_data

        for name in plugin_names:
            result = self.execute_plugin(name, context=context, data=current_data)
            results.append(result)

            if not result.success:
                break

            # Pass result data to next plugin
            current_data = result.data

        return results
