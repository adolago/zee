"""
Investing Logging Configuration

Provides structured logging with JSON format support, request correlation,
performance tracking, and configurable log levels for production observability.
"""

import json
import logging
import os
import sys
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable, Dict, Optional, TypeVar

# Context variable for request correlation
request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
user_id_var: ContextVar[Optional[str]] = ContextVar("user_id", default=None)


# =============================================================================
# Log Level Strategy
# =============================================================================
#
# DEBUG   - Detailed diagnostic information (disabled in production)
#           - Function entry/exit with parameters
#           - Cache hits/misses
#           - Data transformation steps
#           - Query details
#
# INFO    - Significant business events (enabled in production)
#           - Request start/completion with timing
#           - Successful operations (analysis complete, data fetched)
#           - Configuration changes
#           - Component initialization
#
# WARNING - Potential issues that don't stop execution
#           - Fallback to mock data
#           - Deprecated API usage
#           - Slow queries (>1s)
#           - Rate limiting approaching
#
# ERROR   - Errors that affect specific requests
#           - Failed data fetches
#           - Invalid input data
#           - External service errors
#           - Database connection issues
#
# CRITICAL- System-wide failures
#           - Application startup failure
#           - Database unavailable
#           - Critical configuration missing
#           - Memory/resource exhaustion
# =============================================================================


class StructuredFormatter(logging.Formatter):
    """
    JSON structured log formatter for production observability.

    Outputs logs in a format compatible with log aggregation systems
    like ELK Stack, Datadog, Splunk, and CloudWatch.
    """

    def __init__(
        self, service_name: str = "investing-api", environment: str = "development"
    ):
        super().__init__()
        self.service_name = service_name
        self.environment = environment
        self.hostname = os.uname().nodename

    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            # Timestamp in ISO 8601 format with timezone
            "timestamp": datetime.now(timezone.utc).isoformat(),
            # Log level
            "level": record.levelname,
            "level_num": record.levelno,
            # Service identification
            "service": self.service_name,
            "environment": self.environment,
            "hostname": self.hostname,
            # Logger and source location
            "logger": record.name,
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            # Message
            "message": record.getMessage(),
            # Request correlation
            "request_id": request_id_var.get(),
            "user_id": user_id_var.get(),
            # Process info
            "process_id": record.process,
            "thread_id": record.thread,
        }

        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = {
                "type": record.exc_info[0].__name__ if record.exc_info[0] else None,
                "message": str(record.exc_info[1]) if record.exc_info[1] else None,
                "traceback": self.formatException(record.exc_info),
            }

        # Add extra fields from record
        for key, value in record.__dict__.items():
            if key.startswith("ctx_"):
                # Context fields prefixed with ctx_ are included
                log_data[key[4:]] = value

        # Remove None values for cleaner output
        log_data = {k: v for k, v in log_data.items() if v is not None}

        return json.dumps(log_data, default=str)


class ConsoleFormatter(logging.Formatter):
    """
    Human-readable console formatter for development.

    Uses colors and structured format for easy reading during development.
    """

    COLORS = {
        "DEBUG": "\033[36m",  # Cyan
        "INFO": "\033[32m",  # Green
        "WARNING": "\033[33m",  # Yellow
        "ERROR": "\033[31m",  # Red
        "CRITICAL": "\033[35m",  # Magenta
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, self.RESET)
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        request_id = request_id_var.get()
        req_str = f"[{request_id[:8]}]" if request_id else ""

        # Base format
        formatted = (
            f"{timestamp} {color}{record.levelname:8}{self.RESET} "
            f"{req_str} {record.name} - {record.getMessage()}"
        )

        # Add extra context fields
        extras = []
        for key, value in record.__dict__.items():
            if key.startswith("ctx_"):
                extras.append(f"{key[4:]}={value}")
        if extras:
            formatted += f" | {', '.join(extras)}"

        # Add exception if present
        if record.exc_info:
            formatted += f"\n{self.formatException(record.exc_info)}"

        return formatted


def configure_logging(
    level: str = "INFO",
    json_format: bool = False,
    service_name: str = "investing-api",
    environment: str = "development",
    log_file: Optional[str] = None,
) -> None:
    """
    Configure logging for the Investing application.

    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        json_format: Use JSON structured logging (for production)
        service_name: Service name for structured logs
        environment: Environment name (development, staging, production)
        log_file: Optional file path for log output
    """
    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level.upper()))

    # Remove existing handlers
    root_logger.handlers.clear()

    # Choose formatter
    if json_format:
        formatter = StructuredFormatter(service_name, environment)
    else:
        formatter = ConsoleFormatter()

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # File handler (optional)
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(StructuredFormatter(service_name, environment))
        root_logger.addHandler(file_handler)

    # Configure third-party loggers to reduce noise
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("openbb").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger with the given name.

    Args:
        name: Logger name (typically __name__)

    Returns:
        Configured logger instance
    """
    return logging.getLogger(name)


# =============================================================================
# Context Management
# =============================================================================


def set_request_context(
    request_id: Optional[str] = None, user_id: Optional[str] = None
) -> str:
    """
    Set request context for correlation.

    Args:
        request_id: Request ID (generated if not provided)
        user_id: Optional user ID

    Returns:
        The request ID being used
    """
    req_id = request_id or str(uuid.uuid4())
    request_id_var.set(req_id)
    if user_id:
        user_id_var.set(user_id)
    return req_id


def clear_request_context() -> None:
    """Clear request context after request completion."""
    request_id_var.set(None)
    user_id_var.set(None)


def get_request_id() -> Optional[str]:
    """Get current request ID."""
    return request_id_var.get()


# =============================================================================
# Performance Logging Decorator
# =============================================================================

T = TypeVar("T")


def log_performance(
    threshold_ms: float = 1000.0,
    log_args: bool = False,
    log_result: bool = False,
) -> Callable:
    """
    Decorator to log function performance.

    Args:
        threshold_ms: Log warning if execution exceeds this threshold
        log_args: Include function arguments in log
        log_result: Include function result in log

    Example:
        @log_performance(threshold_ms=500)
        async def slow_operation(symbol: str):
            ...
    """

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        logger = logging.getLogger(func.__module__)

        @wraps(func)
        async def async_wrapper(*args, **kwargs) -> T:
            start_time = time.perf_counter()

            extra: Dict[str, Any] = {
                "ctx_function": func.__name__,
                "ctx_operation": "function_call",
            }

            if log_args:
                extra["ctx_args"] = str(args)[:200]
                extra["ctx_kwargs"] = str(kwargs)[:200]

            try:
                result = await func(*args, **kwargs)
                duration_ms = (time.perf_counter() - start_time) * 1000
                extra["ctx_duration_ms"] = round(duration_ms, 2)
                extra["ctx_status"] = "success"

                if log_result:
                    extra["ctx_result_type"] = type(result).__name__

                if duration_ms > threshold_ms:
                    logger.warning(
                        f"Slow operation: {func.__name__} took {duration_ms:.2f}ms",
                        extra=extra,
                    )
                else:
                    logger.debug(
                        f"Operation completed: {func.__name__} in {duration_ms:.2f}ms",
                        extra=extra,
                    )

                return result

            except Exception as e:
                duration_ms = (time.perf_counter() - start_time) * 1000
                extra["ctx_duration_ms"] = round(duration_ms, 2)
                extra["ctx_status"] = "error"
                extra["ctx_error_type"] = type(e).__name__

                logger.error(
                    f"Operation failed: {func.__name__} - {str(e)}",
                    extra=extra,
                    exc_info=True,
                )
                raise

        @wraps(func)
        def sync_wrapper(*args, **kwargs) -> T:
            start_time = time.perf_counter()

            extra: Dict[str, Any] = {
                "ctx_function": func.__name__,
                "ctx_operation": "function_call",
            }

            if log_args:
                extra["ctx_args"] = str(args)[:200]
                extra["ctx_kwargs"] = str(kwargs)[:200]

            try:
                result = func(*args, **kwargs)
                duration_ms = (time.perf_counter() - start_time) * 1000
                extra["ctx_duration_ms"] = round(duration_ms, 2)
                extra["ctx_status"] = "success"

                if log_result:
                    extra["ctx_result_type"] = type(result).__name__

                if duration_ms > threshold_ms:
                    logger.warning(
                        f"Slow operation: {func.__name__} took {duration_ms:.2f}ms",
                        extra=extra,
                    )
                else:
                    logger.debug(
                        f"Operation completed: {func.__name__} in {duration_ms:.2f}ms",
                        extra=extra,
                    )

                return result

            except Exception as e:
                duration_ms = (time.perf_counter() - start_time) * 1000
                extra["ctx_duration_ms"] = round(duration_ms, 2)
                extra["ctx_status"] = "error"
                extra["ctx_error_type"] = type(e).__name__

                logger.error(
                    f"Operation failed: {func.__name__} - {str(e)}",
                    extra=extra,
                    exc_info=True,
                )
                raise

        import asyncio

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator


# =============================================================================
# Structured Log Helpers
# =============================================================================


class LogContext:
    """Context manager for adding structured fields to logs within a block."""

    def __init__(self, logger: logging.Logger, **fields: Any):
        self.logger = logger
        self.fields = {f"ctx_{k}": v for k, v in fields.items()}
        self._old_factory = None

    def __enter__(self):
        old_factory = logging.getLogRecordFactory()
        self._old_factory = old_factory
        fields = self.fields

        def record_factory(*args, **kwargs):
            record = old_factory(*args, **kwargs)
            for key, value in fields.items():
                setattr(record, key, value)
            return record

        logging.setLogRecordFactory(record_factory)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._old_factory:
            logging.setLogRecordFactory(self._old_factory)


def log_with_context(
    logger: logging.Logger, level: int, message: str, **context: Any
) -> None:
    """
    Log a message with additional context fields.

    Args:
        logger: Logger instance
        level: Log level (logging.INFO, etc.)
        message: Log message
        **context: Additional context fields
    """
    extra = {f"ctx_{k}": v for k, v in context.items()}
    logger.log(level, message, extra=extra)


# =============================================================================
# Business Event Logging
# =============================================================================


class BusinessLogger:
    """
    Logger for business-level events with structured context.

    Provides consistent logging for key business operations.
    """

    def __init__(self, logger_name: str = "investing.business"):
        self.logger = logging.getLogger(logger_name)

    def log_api_request(
        self,
        endpoint: str,
        method: str,
        status_code: int,
        duration_ms: float,
        symbol: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        """Log API request completion."""
        extra = {
            "ctx_event": "api_request",
            "ctx_endpoint": endpoint,
            "ctx_method": method,
            "ctx_status_code": status_code,
            "ctx_duration_ms": round(duration_ms, 2),
        }
        if symbol:
            extra["ctx_symbol"] = symbol
        if error:
            extra["ctx_error"] = error

        level = logging.INFO if status_code < 400 else logging.ERROR
        self.logger.log(
            level,
            f"{method} {endpoint} -> {status_code} ({duration_ms:.2f}ms)",
            extra=extra,
        )

    def log_analysis_complete(
        self,
        analysis_type: str,
        symbol: str,
        duration_ms: float,
        result_count: Optional[int] = None,
    ) -> None:
        """Log analysis operation completion."""
        extra = {
            "ctx_event": "analysis_complete",
            "ctx_analysis_type": analysis_type,
            "ctx_symbol": symbol,
            "ctx_duration_ms": round(duration_ms, 2),
        }
        if result_count is not None:
            extra["ctx_result_count"] = result_count

        self.logger.info(
            f"Analysis complete: {analysis_type} for {symbol}",
            extra=extra,
        )

    def log_data_fetch(
        self,
        source: str,
        data_type: str,
        symbol: str,
        duration_ms: float,
        rows: Optional[int] = None,
        cache_hit: bool = False,
    ) -> None:
        """Log data fetch operation."""
        extra = {
            "ctx_event": "data_fetch",
            "ctx_source": source,
            "ctx_data_type": data_type,
            "ctx_symbol": symbol,
            "ctx_duration_ms": round(duration_ms, 2),
            "ctx_cache_hit": cache_hit,
        }
        if rows is not None:
            extra["ctx_rows"] = rows

        self.logger.info(
            f"Data fetched: {data_type} for {symbol} from {source}",
            extra=extra,
        )

    def log_external_api_call(
        self,
        service: str,
        endpoint: str,
        status_code: int,
        duration_ms: float,
        error: Optional[str] = None,
    ) -> None:
        """Log external API call."""
        extra = {
            "ctx_event": "external_api_call",
            "ctx_service": service,
            "ctx_endpoint": endpoint,
            "ctx_status_code": status_code,
            "ctx_duration_ms": round(duration_ms, 2),
        }
        if error:
            extra["ctx_error"] = error

        level = logging.INFO if status_code < 400 else logging.WARNING
        self.logger.log(
            level,
            f"External API: {service} {endpoint} -> {status_code}",
            extra=extra,
        )


# Export business logger singleton
business_logger = BusinessLogger()
