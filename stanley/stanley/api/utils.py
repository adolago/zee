"""
Stanley API Utilities
"""

import os
import html
from datetime import datetime, timezone
from typing import Any, Optional
from html.parser import HTMLParser
import numpy as np
from fastapi import HTTPException


def get_timestamp() -> str:
    """Get current ISO timestamp."""
    # Use timezone-aware UTC datetime
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def is_debug_mode() -> bool:
    """
    Check if debug mode is enabled from environment variables.

    Returns True if DEBUG env var is set to 'true', '1', 'yes', or 'on' (case-insensitive).
    """
    val = os.environ.get("DEBUG", "").lower()
    return val in ("true", "1", "yes", "on")


def _convert_numpy_types(obj: Any) -> Any:
    """Convert numpy types to native Python types for JSON serialization."""
    if isinstance(obj, dict):
        return {k: _convert_numpy_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_convert_numpy_types(v) for v in obj]
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj) if not np.isnan(obj) else None
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


def create_response(
    data: Any = None, error: Optional[str] = None, success: bool = True
) -> dict:
    """Create a standardized API response."""
    converted_data = _convert_numpy_types(data) if data is not None else None

    return {
        "success": success and error is None,
        "data": converted_data,
        "error": error,
        "timestamp": get_timestamp(),
    }


def sanitize_error(e: Exception) -> str:
    """
    Return a safe error message for public consumption.
    Hides internal details unless DEBUG is enabled.
    """
    if is_debug_mode():
        return str(e)

    # Trusted exception types that are safe to expose
    if isinstance(e, (HTTPException,)):
        return e.detail

    # Log the full error internally if not already logged, but here we assume caller logs it
    return "An internal error occurred. Please try again later."


def sanitize_log_input(value: Any, max_length: int = 100) -> str:
    """
    Sanitize user input for safe logging to prevent log injection attacks.

    This function:
    - Converts non-strings to strings
    - Removes control characters and newlines that could be used for log injection
    - Truncates to prevent log flooding
    - Returns a safe string suitable for logging

    Args:
        value: The user-provided value to sanitize
        max_length: Maximum length of the sanitized output (default 100)

    Returns:
        A sanitized string safe for logging
    """
    if value is None:
        return "<none>"
    if not isinstance(value, str):
        value = str(value)
    # Remove control characters, newlines, and carriage returns
    sanitized = "".join(
        c if c.isprintable() and c not in "\n\r\t" else "_" for c in value
    )
    # Truncate to max length
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length] + "..."
    return sanitized


class XSSSanitizer(HTMLParser):
    """
    HTML Parser that strips dangerous tags and attributes.

    Removes:
    - Dangerous tags: script, iframe, object, embed, applet, style
    - Dangerous attributes: on* (event handlers), javascript: URIs
    - Content within dangerous tags
    """

    def __init__(self):
        # Disable charref conversion to prevent entity decoding bypasses (e.g. &lt;script&gt; -> <script>)
        super().__init__(convert_charrefs=False)
        self.result = []
        self.forbidden_tags = {
            "script",
            "iframe",
            "object",
            "embed",
            "applet",
            "style",
            "link",
            "meta",
            "base",
            "form",
        }
        self.ignore_content = False
        self.ignore_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag.lower() in self.forbidden_tags:
            self.ignore_content = True
            self.ignore_depth += 1
            return

        if self.ignore_content:
            self.ignore_depth += 1
            return

        safe_attrs = []
        for name, value in attrs:
            # Strip event handlers (onload, onclick, etc)
            if name.lower().startswith("on"):
                continue

            # Strip javascript: URIs
            # Normalize to catch obfuscation: java\nscript, j a v a s c r i p t
            if value:
                # Remove non-alphanumeric chars except colon for check
                normalized = "".join(
                    c.lower() for c in value if c.isalnum() or c == ":"
                )
                if "javascript:" in normalized:
                    continue
                # Also check for vbscript: and data: (if executing script)
                if "vbscript:" in normalized:
                    continue

            safe_attrs.append((name, value))

        attr_str = ""
        if safe_attrs:
            attr_str = " " + " ".join(
                f'{k}="{v}"' for k, v in safe_attrs if v is not None
            )

        self.result.append(f"<{tag}{attr_str}>")

    def handle_endtag(self, tag):
        if tag.lower() in self.forbidden_tags:
            self.ignore_depth -= 1
            if self.ignore_depth <= 0:
                self.ignore_content = False
                self.ignore_depth = 0
            return

        if self.ignore_content:
            self.ignore_depth -= 1
            return

        self.result.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.ignore_content:
            self.result.append(data)

    def handle_entityref(self, name):
        if not self.ignore_content:
            self.result.append(f"&{name};")

    def handle_charref(self, name):
        if not self.ignore_content:
            self.result.append(f"&#{name};")

    def get_data(self):
        return "".join(self.result)


def sanitize_html(content: str) -> str:
    """
    Sanitize HTML/Markdown content to prevent XSS.

    Uses XSSSanitizer (HTMLParser subclass) to strip dangerous tags
    and attributes while preserving safe HTML and text.

    Args:
        content: The content to sanitize

    Returns:
        Sanitized content safe for storage/display
    """
    if not content:
        return ""

    try:
        parser = XSSSanitizer()
        parser.feed(content)
        return parser.get_data()
    except Exception:
        # Fallback to HTML escaping to prevent execution while preserving data
        # This is safer than returning empty string (data loss)
        return html.escape(content)
