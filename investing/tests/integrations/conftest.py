"""
Conftest for integration tests.

This module provides fixtures and skip markers for integration tests
that require optional dependencies like nautilus_trader.
"""

import pytest

# Check if nautilus_trader is available
try:
    import nautilus_trader

    HAS_NAUTILUS = True
except ImportError:
    HAS_NAUTILUS = False


# Check if openbb is available
try:
    import openbb

    HAS_OPENBB = True
except ImportError:
    HAS_OPENBB = False


# Skip decorators for optional dependencies
requires_nautilus = pytest.mark.skipif(
    not HAS_NAUTILUS, reason="nautilus_trader not installed"
)

requires_openbb = pytest.mark.skipif(not HAS_OPENBB, reason="openbb not installed")


def pytest_collection_modifyitems(config, items):
    """Automatically skip tests that require missing dependencies.

    Note: The Investing Nautilus actors (MoneyFlowActor, InstitutionalActor) are
    standalone implementations that do NOT require the nautilus_trader package.
    They use a test-friendly design with injected mocks for Nautilus components.

    Tests that DO require nautilus_trader:
    - test_nautilus_data_client.py (imports data_client which uses nautilus_trader)
    - test_nautilus_indicators.py (imports indicators which use nautilus_trader)
    - test_end_to_end.py (full integration tests)
    """
    for item in items:
        # Check for end-to-end tests (which require both nautilus and openbb)
        if "end_to_end" in item.nodeid.lower():
            if not HAS_NAUTILUS:
                item.add_marker(
                    pytest.mark.skip(
                        reason="nautilus_trader not installed (required for e2e tests)"
                    )
                )
            elif not HAS_OPENBB:
                item.add_marker(
                    pytest.mark.skip(
                        reason="openbb not installed (required for end-to-end tests)"
                    )
                )

        # Check for nautilus data_client tests (require nautilus_trader)
        if "test_nautilus_data_client" in item.nodeid.lower():
            if not HAS_NAUTILUS:
                item.add_marker(
                    pytest.mark.skip(
                        reason="nautilus_trader not installed (required for data client tests)"
                    )
                )

        # Check for nautilus indicators tests (require nautilus_trader)
        if "test_nautilus_indicators" in item.nodeid.lower():
            if not HAS_NAUTILUS:
                item.add_marker(
                    pytest.mark.skip(
                        reason="nautilus_trader not installed (required for indicator tests)"
                    )
                )

        # Check for openbb-related tests
        if "openbb" in item.nodeid.lower() and "mock" not in item.nodeid.lower():
            if not HAS_OPENBB:
                item.add_marker(pytest.mark.skip(reason="openbb not installed"))
