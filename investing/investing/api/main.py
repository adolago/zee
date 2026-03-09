"""
Investing REST API - Legacy Entry Point (Redirect)
================================================

This module is a backward-compatibility wrapper that redirects to the new
application factory in `investing.api.main_new`.

WARNING: This module is deprecated. Please update your imports/scripts to use:
    from investing.api.main_new import app, create_app

This wrapper ensures that:
1. Legacy imports of `app` get the SECURE, correctly configured application.
2. Legacy usages of `app_state` (if any) are warned but supported if possible.
3. Tests using this module will now run against the secure application.
"""

import logging
import warnings

# Import the secure application from the new location
from investing.api.main_new import app, run_dev_server

# Also re-export helpers if they were present in the old main
from investing.api.utils import create_response, get_timestamp

logger = logging.getLogger(__name__)

warnings.warn(
    "Importing from 'investing.api.main' is deprecated. Use 'investing.api.main_new' instead.",
    DeprecationWarning,
    stacklevel=2,
)


# Re-define AppState class for legacy compatibility (tests rely on this class being here)
class AppState:
    """Application state container (Legacy Compatibility)."""

    def __init__(self):
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
        # Added based on test usage
        self.whale_tracker = None
        self.options_flow_analyzer = None
        self.sector_rotation_analyzer = None
        self.smart_money_index = None


# Create a concrete instance for tests to patch
app_state = AppState()

# Inject this instance into the secure app's state.
# This ensures that when tests patch `investing.api.main.app_state`,
# the `app` instance (from main_new) actually sees those mocks.
#
# NOTE: By setting this, `main_new.lifespan` will skip initializing a fresh container
# and will use this (mostly empty) object. This is desired for tests which mock components.
# For production, you should use `investing.api.main_new` directly.
app.state.app_state = app_state
