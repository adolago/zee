"""
Investing Metrics Collection

Provides performance and business metrics collection for monitoring.
Compatible with Prometheus, StatsD, and custom backends.
"""

import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Callable, Dict, List, Optional, TypeVar

T = TypeVar("T")


# =============================================================================
# Metrics Data Structures
# =============================================================================


@dataclass
class MetricSample:
    """Single metric sample with timestamp."""

    value: float
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    labels: Dict[str, str] = field(default_factory=dict)


@dataclass
class HistogramBuckets:
    """Histogram bucket configuration for latency metrics."""

    # Default buckets for API latency (in milliseconds)
    API_LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]

    # Default buckets for analysis duration (in milliseconds)
    ANALYSIS_DURATION_BUCKETS = [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]

    # Default buckets for data fetch latency (in milliseconds)
    DATA_FETCH_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000]


# =============================================================================
# Metrics Collector
# =============================================================================


class MetricsCollector:
    """
    Collects and aggregates application metrics.

    Thread-safe metrics collection for counters, gauges, and histograms.
    """

    def __init__(self, max_samples: int = 10000):
        self._lock = Lock()
        self._max_samples = max_samples

        # Counters (monotonically increasing)
        self._counters: Dict[str, float] = defaultdict(float)
        self._counter_labels: Dict[str, Dict[str, str]] = {}

        # Gauges (point-in-time values)
        self._gauges: Dict[str, float] = defaultdict(float)
        self._gauge_labels: Dict[str, Dict[str, str]] = {}

        # Histograms (distribution of values)
        self._histograms: Dict[str, List[float]] = defaultdict(list)
        self._histogram_labels: Dict[str, Dict[str, str]] = {}
        self._histogram_buckets: Dict[str, List[float]] = {}

        # Timing samples for moving averages
        self._timing_samples: Dict[str, List[MetricSample]] = defaultdict(list)

    def _make_key(self, name: str, labels: Optional[Dict[str, str]] = None) -> str:
        """Create a unique key from metric name and labels."""
        if not labels:
            return name
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}{{{label_str}}}"

    # -------------------------------------------------------------------------
    # Counter Operations
    # -------------------------------------------------------------------------

    def increment_counter(
        self,
        name: str,
        value: float = 1.0,
        labels: Optional[Dict[str, str]] = None,
    ) -> None:
        """Increment a counter metric."""
        key = self._make_key(name, labels)
        with self._lock:
            self._counters[key] += value
            if labels:
                self._counter_labels[key] = labels

    def get_counter(
        self,
        name: str,
        labels: Optional[Dict[str, str]] = None,
    ) -> float:
        """Get current counter value."""
        key = self._make_key(name, labels)
        with self._lock:
            return self._counters.get(key, 0.0)

    # -------------------------------------------------------------------------
    # Gauge Operations
    # -------------------------------------------------------------------------

    def set_gauge(
        self,
        name: str,
        value: float,
        labels: Optional[Dict[str, str]] = None,
    ) -> None:
        """Set a gauge metric value."""
        key = self._make_key(name, labels)
        with self._lock:
            self._gauges[key] = value
            if labels:
                self._gauge_labels[key] = labels

    def get_gauge(
        self,
        name: str,
        labels: Optional[Dict[str, str]] = None,
    ) -> float:
        """Get current gauge value."""
        key = self._make_key(name, labels)
        with self._lock:
            return self._gauges.get(key, 0.0)

    def increment_gauge(
        self,
        name: str,
        value: float = 1.0,
        labels: Optional[Dict[str, str]] = None,
    ) -> None:
        """Increment a gauge metric."""
        key = self._make_key(name, labels)
        with self._lock:
            self._gauges[key] = self._gauges.get(key, 0.0) + value
            if labels:
                self._gauge_labels[key] = labels

    def decrement_gauge(
        self,
        name: str,
        value: float = 1.0,
        labels: Optional[Dict[str, str]] = None,
    ) -> None:
        """Decrement a gauge metric."""
        key = self._make_key(name, labels)
        with self._lock:
            self._gauges[key] = self._gauges.get(key, 0.0) - value
            if labels:
                self._gauge_labels[key] = labels

    # -------------------------------------------------------------------------
    # Histogram Operations
    # -------------------------------------------------------------------------

    def observe_histogram(
        self,
        name: str,
        value: float,
        labels: Optional[Dict[str, str]] = None,
        buckets: Optional[List[float]] = None,
    ) -> None:
        """Add an observation to a histogram."""
        key = self._make_key(name, labels)
        with self._lock:
            self._histograms[key].append(value)
            if labels:
                self._histogram_labels[key] = labels
            if buckets:
                self._histogram_buckets[key] = buckets

            # Trim if exceeding max samples
            if len(self._histograms[key]) > self._max_samples:
                self._histograms[key] = self._histograms[key][-self._max_samples :]

    def get_histogram_stats(
        self,
        name: str,
        labels: Optional[Dict[str, str]] = None,
    ) -> Dict[str, float]:
        """Get histogram statistics."""
        key = self._make_key(name, labels)
        with self._lock:
            values = self._histograms.get(key, [])
            if not values:
                return {
                    "count": 0,
                    "sum": 0.0,
                    "min": 0.0,
                    "max": 0.0,
                    "avg": 0.0,
                    "p50": 0.0,
                    "p90": 0.0,
                    "p95": 0.0,
                    "p99": 0.0,
                }

            sorted_values = sorted(values)
            count = len(sorted_values)

            return {
                "count": count,
                "sum": sum(sorted_values),
                "min": sorted_values[0],
                "max": sorted_values[-1],
                "avg": sum(sorted_values) / count,
                "p50": self._percentile(sorted_values, 50),
                "p90": self._percentile(sorted_values, 90),
                "p95": self._percentile(sorted_values, 95),
                "p99": self._percentile(sorted_values, 99),
            }

    def _percentile(self, sorted_values: List[float], percentile: float) -> float:
        """Calculate percentile from sorted values."""
        if not sorted_values:
            return 0.0
        index = int((percentile / 100) * len(sorted_values))
        index = min(index, len(sorted_values) - 1)
        return sorted_values[index]

    # -------------------------------------------------------------------------
    # Timing Operations
    # -------------------------------------------------------------------------

    def record_timing(
        self,
        name: str,
        duration_ms: float,
        labels: Optional[Dict[str, str]] = None,
    ) -> None:
        """Record a timing measurement."""
        # Also add to histogram for percentile calculations
        self.observe_histogram(
            name,
            duration_ms,
            labels,
            HistogramBuckets.API_LATENCY_BUCKETS,
        )

        # Store sample for time-series analysis
        key = self._make_key(name, labels)
        with self._lock:
            self._timing_samples[key].append(
                MetricSample(value=duration_ms, labels=labels or {})
            )
            if len(self._timing_samples[key]) > self._max_samples:
                self._timing_samples[key] = self._timing_samples[key][
                    -self._max_samples :
                ]

    # -------------------------------------------------------------------------
    # Export/Query Operations
    # -------------------------------------------------------------------------

    def get_all_metrics(self) -> Dict[str, Any]:
        """Get all current metrics."""
        with self._lock:
            result = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "counters": dict(self._counters),
                "gauges": dict(self._gauges),
                "histograms": {},
            }

            # Add histogram stats
            for key in self._histograms:
                result["histograms"][key] = self.get_histogram_stats(key)

            return result

    def get_prometheus_format(self) -> str:
        """Export metrics in Prometheus text format."""
        lines = []

        with self._lock:
            # Export counters
            for key, value in self._counters.items():
                lines.append(f"# TYPE {key.split('{')[0]} counter")
                lines.append(f"{key} {value}")

            # Export gauges
            for key, value in self._gauges.items():
                lines.append(f"# TYPE {key.split('{')[0]} gauge")
                lines.append(f"{key} {value}")

            # Export histograms
            for key, values in self._histograms.items():
                base_name = key.split("{")[0]
                labels = key[len(base_name) :] if "{" in key else ""
                buckets = self._histogram_buckets.get(
                    key, HistogramBuckets.API_LATENCY_BUCKETS
                )

                lines.append(f"# TYPE {base_name} histogram")

                sorted_values = sorted(values)
                total = len(sorted_values)
                running_count = 0

                for bucket in buckets:
                    while (
                        running_count < total and sorted_values[running_count] <= bucket
                    ):
                        running_count += 1
                    bucket_labels = (
                        labels.rstrip("}") + f',le="{bucket}"}}'
                        if labels
                        else f'{{le="{bucket}"}}'
                    )
                    lines.append(f"{base_name}_bucket{bucket_labels} {running_count}")

                inf_labels = (
                    labels.rstrip("}") + ',le="+Inf"}}' if labels else '{le="+Inf"}'
                )
                lines.append(f"{base_name}_bucket{inf_labels} {total}")
                lines.append(f"{base_name}_sum{labels} {sum(sorted_values)}")
                lines.append(f"{base_name}_count{labels} {total}")

        return "\n".join(lines)

    def reset(self) -> None:
        """Reset all metrics (useful for testing)."""
        with self._lock:
            self._counters.clear()
            self._gauges.clear()
            self._histograms.clear()
            self._timing_samples.clear()


# =============================================================================
# Global Metrics Instance
# =============================================================================

# Singleton metrics collector
_metrics = MetricsCollector()


def get_metrics() -> MetricsCollector:
    """Get the global metrics collector instance."""
    return _metrics


# =============================================================================
# Metric Decorators
# =============================================================================


def count_calls(
    metric_name: str,
    labels: Optional[Dict[str, str]] = None,
) -> Callable:
    """Decorator to count function calls."""

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        from functools import wraps

        @wraps(func)
        async def async_wrapper(*args, **kwargs) -> T:
            _metrics.increment_counter(metric_name, labels=labels)
            return await func(*args, **kwargs)

        @wraps(func)
        def sync_wrapper(*args, **kwargs) -> T:
            _metrics.increment_counter(metric_name, labels=labels)
            return func(*args, **kwargs)

        import asyncio

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator


def measure_time(
    metric_name: str,
    labels: Optional[Dict[str, str]] = None,
) -> Callable:
    """Decorator to measure function execution time."""

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        from functools import wraps

        @wraps(func)
        async def async_wrapper(*args, **kwargs) -> T:
            start = time.perf_counter()
            try:
                return await func(*args, **kwargs)
            finally:
                duration_ms = (time.perf_counter() - start) * 1000
                _metrics.record_timing(metric_name, duration_ms, labels)

        @wraps(func)
        def sync_wrapper(*args, **kwargs) -> T:
            start = time.perf_counter()
            try:
                return func(*args, **kwargs)
            finally:
                duration_ms = (time.perf_counter() - start) * 1000
                _metrics.record_timing(metric_name, duration_ms, labels)

        import asyncio

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator


# =============================================================================
# Pre-defined Metric Names
# =============================================================================


class MetricNames:
    """Standard metric names for Investing API."""

    # Request metrics
    HTTP_REQUESTS_TOTAL = "stanley_http_requests_total"
    HTTP_REQUEST_DURATION_MS = "stanley_http_request_duration_ms"
    HTTP_REQUESTS_IN_FLIGHT = "stanley_http_requests_in_flight"

    # Analysis metrics
    ANALYSIS_REQUESTS_TOTAL = "stanley_analysis_requests_total"
    ANALYSIS_DURATION_MS = "stanley_analysis_duration_ms"
    ANALYSIS_ERRORS_TOTAL = "stanley_analysis_errors_total"

    # Data fetch metrics
    DATA_FETCH_TOTAL = "stanley_data_fetch_total"
    DATA_FETCH_DURATION_MS = "stanley_data_fetch_duration_ms"
    DATA_FETCH_ERRORS_TOTAL = "stanley_data_fetch_errors_total"
    DATA_CACHE_HITS_TOTAL = "stanley_data_cache_hits_total"
    DATA_CACHE_MISSES_TOTAL = "stanley_data_cache_misses_total"

    # External API metrics
    EXTERNAL_API_REQUESTS_TOTAL = "stanley_external_api_requests_total"
    EXTERNAL_API_DURATION_MS = "stanley_external_api_duration_ms"
    EXTERNAL_API_ERRORS_TOTAL = "stanley_external_api_errors_total"

    # Component health
    COMPONENT_UP = "stanley_component_up"
    COMPONENT_LAST_CHECK = "stanley_component_last_check_timestamp"

    # Business metrics
    SYMBOLS_ANALYZED = "stanley_symbols_analyzed_total"
    POPULAR_ENDPOINTS = "stanley_endpoint_calls_total"
    ACTIVE_SESSIONS = "stanley_active_sessions"


# =============================================================================
# Business Metrics Helper
# =============================================================================


class BusinessMetrics:
    """Helper class for recording business-level metrics."""

    def __init__(self, collector: Optional[MetricsCollector] = None):
        self.metrics = collector or _metrics

    def record_api_call(
        self,
        endpoint: str,
        method: str,
        status_code: int,
        duration_ms: float,
    ) -> None:
        """Record an API call with all relevant metrics."""
        labels = {"endpoint": endpoint, "method": method, "status": str(status_code)}

        self.metrics.increment_counter(MetricNames.HTTP_REQUESTS_TOTAL, labels=labels)
        self.metrics.record_timing(
            MetricNames.HTTP_REQUEST_DURATION_MS, duration_ms, labels
        )
        self.metrics.increment_counter(
            MetricNames.POPULAR_ENDPOINTS, labels={"endpoint": endpoint}
        )

        if status_code >= 500:
            self.metrics.increment_counter(
                MetricNames.ANALYSIS_ERRORS_TOTAL, labels={"endpoint": endpoint}
            )

    def record_analysis(
        self,
        analysis_type: str,
        symbol: str,
        duration_ms: float,
        success: bool = True,
    ) -> None:
        """Record an analysis operation."""
        labels = {"type": analysis_type, "symbol": symbol}

        self.metrics.increment_counter(
            MetricNames.ANALYSIS_REQUESTS_TOTAL, labels=labels
        )
        self.metrics.record_timing(
            MetricNames.ANALYSIS_DURATION_MS, duration_ms, labels
        )
        self.metrics.increment_counter(
            MetricNames.SYMBOLS_ANALYZED, labels={"symbol": symbol}
        )

        if not success:
            self.metrics.increment_counter(
                MetricNames.ANALYSIS_ERRORS_TOTAL, labels=labels
            )

    def record_data_fetch(
        self,
        source: str,
        data_type: str,
        duration_ms: float,
        cache_hit: bool = False,
        success: bool = True,
    ) -> None:
        """Record a data fetch operation."""
        labels = {"source": source, "type": data_type}

        self.metrics.increment_counter(MetricNames.DATA_FETCH_TOTAL, labels=labels)
        self.metrics.record_timing(
            MetricNames.DATA_FETCH_DURATION_MS, duration_ms, labels
        )

        if cache_hit:
            self.metrics.increment_counter(
                MetricNames.DATA_CACHE_HITS_TOTAL, labels=labels
            )
        else:
            self.metrics.increment_counter(
                MetricNames.DATA_CACHE_MISSES_TOTAL, labels=labels
            )

        if not success:
            self.metrics.increment_counter(
                MetricNames.DATA_FETCH_ERRORS_TOTAL, labels=labels
            )

    def set_component_health(self, component: str, is_healthy: bool) -> None:
        """Set component health status."""
        self.metrics.set_gauge(
            MetricNames.COMPONENT_UP,
            1.0 if is_healthy else 0.0,
            labels={"component": component},
        )
        self.metrics.set_gauge(
            MetricNames.COMPONENT_LAST_CHECK,
            time.time(),
            labels={"component": component},
        )

    def track_in_flight_request(self, increment: bool = True) -> None:
        """Track in-flight requests."""
        if increment:
            self.metrics.increment_gauge(MetricNames.HTTP_REQUESTS_IN_FLIGHT)
        else:
            self.metrics.decrement_gauge(MetricNames.HTTP_REQUESTS_IN_FLIGHT)


# Export business metrics singleton
business_metrics = BusinessMetrics()
