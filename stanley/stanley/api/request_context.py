"""Request-scoped context for the Stanley API.

Routers historically relied on module-level globals (e.g. `_app_state`) or
imports from `stanley.api.main` to access the application's state.

To keep routers decoupled from a specific entrypoint while still allowing
simple helper functions like `get_app_state()` to work, we store the
current request's app_state in a ContextVar.

The context is set by middleware in `stanley.api.main_new` for each request.
"""

from __future__ import annotations

from contextvars import ContextVar, Token
from typing import Any, Optional

_current_app_state: ContextVar[Optional[Any]] = ContextVar(
    "stanley_current_app_state", default=None
)


def set_current_app_state(state: Any) -> Token[Optional[Any]]:
    """Set the current request's app_state and return a token for reset."""
    return _current_app_state.set(state)


def reset_current_app_state(token: Token[Optional[Any]]) -> None:
    """Reset the current request's app_state using the provided token."""
    _current_app_state.reset(token)


def get_current_app_state() -> Optional[Any]:
    """Get the current request's app_state (or None if not set)."""
    return _current_app_state.get()
