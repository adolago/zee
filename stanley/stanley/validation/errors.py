"""
Validation Errors Module

Custom exception hierarchy for Stanley validation system.
Provides specific error types for different validation failures.
"""

from typing import Any, Dict, List, Optional


class ValidationError(Exception):
    """Base validation error for all Stanley validation failures."""

    def __init__(
        self,
        message: str,
        field: Optional[str] = None,
        value: Any = None,
        code: str = "VALIDATION_ERROR",
        details: Optional[Dict[str, Any]] = None,
    ):
        self.message = message
        self.field = field
        self.value = value
        self.code = code
        self.details = details or {}
        super().__init__(message)

    def to_dict(self) -> Dict[str, Any]:
        """Convert error to dictionary for API response."""
        return {
            "code": self.code,
            "message": self.message,
            "field": self.field,
            "value": self._safe_value_repr(),
            "details": self.details,
        }

    def _safe_value_repr(self) -> Optional[str]:
        """Safely represent value without exposing sensitive data."""
        if self.value is None:
            return None
        if isinstance(self.value, (str, int, float, bool)):
            value_str = str(self.value)
            if len(value_str) > 100:
                return value_str[:100] + "..."
            return value_str
        return f"<{type(self.value).__name__}>"


class DataQualityError(ValidationError):
    """Error raised when data quality checks fail."""

    def __init__(
        self,
        message: str,
        field: Optional[str] = None,
        value: Any = None,
        quality_level: Optional[str] = None,
        quality_score: Optional[float] = None,
        issues: Optional[List[str]] = None,
    ):
        super().__init__(
            message=message,
            field=field,
            value=value,
            code="DATA_QUALITY_ERROR",
            details={
                "quality_level": quality_level,
                "quality_score": quality_score,
                "issues": issues or [],
            },
        )
        self.quality_level = quality_level
        self.quality_score = quality_score
        self.issues = issues or []


class OutlierError(ValidationError):
    """Error raised when outlier detection fails or finds critical outliers."""

    def __init__(
        self,
        message: str,
        field: Optional[str] = None,
        value: Any = None,
        outlier_type: str = "unknown",
        threshold: Optional[float] = None,
        score: Optional[float] = None,
        method: str = "unknown",
    ):
        super().__init__(
            message=message,
            field=field,
            value=value,
            code="OUTLIER_ERROR",
            details={
                "outlier_type": outlier_type,
                "threshold": threshold,
                "score": score,
                "detection_method": method,
            },
        )
        self.outlier_type = outlier_type
        self.threshold = threshold
        self.score = score
        self.method = method


class SanityCheckError(ValidationError):
    """Error raised when sanity checks fail."""

    def __init__(
        self,
        message: str,
        field: Optional[str] = None,
        value: Any = None,
        check_name: str = "unknown",
        expected_range: Optional[tuple] = None,
        actual_value: Any = None,
    ):
        super().__init__(
            message=message,
            field=field,
            value=value,
            code="SANITY_CHECK_ERROR",
            details={
                "check_name": check_name,
                "expected_range": expected_range,
                "actual_value": actual_value,
            },
        )
        self.check_name = check_name
        self.expected_range = expected_range
        self.actual_value = actual_value


class TemporalValidationError(ValidationError):
    """Error raised when temporal validation fails."""

    def __init__(
        self,
        message: str,
        field: Optional[str] = None,
        value: Any = None,
        validation_type: str = "unknown",
        expected_time: Optional[str] = None,
        actual_time: Optional[str] = None,
        staleness_hours: Optional[float] = None,
    ):
        super().__init__(
            message=message,
            field=field,
            value=value,
            code="TEMPORAL_VALIDATION_ERROR",
            details={
                "validation_type": validation_type,
                "expected_time": expected_time,
                "actual_time": actual_time,
                "staleness_hours": staleness_hours,
            },
        )
        self.validation_type = validation_type
        self.expected_time = expected_time
        self.actual_time = actual_time
        self.staleness_hours = staleness_hours


class CrossFieldValidationError(ValidationError):
    """Error raised when cross-field validation fails."""

    def __init__(
        self,
        message: str,
        fields: List[str],
        values: Optional[Dict[str, Any]] = None,
        constraint: str = "unknown",
    ):
        super().__init__(
            message=message,
            field=", ".join(fields),
            value=values,
            code="CROSS_FIELD_VALIDATION_ERROR",
            details={
                "fields": fields,
                "constraint": constraint,
            },
        )
        self.fields = fields
        self.values = values
        self.constraint = constraint


class SymbolValidationError(ValidationError):
    """Error raised when symbol validation fails."""

    def __init__(
        self,
        symbol: str,
        reason: str,
        suggestions: Optional[List[str]] = None,
    ):
        super().__init__(
            message=f"Invalid symbol '{symbol}': {reason}",
            field="symbol",
            value=symbol,
            code="SYMBOL_VALIDATION_ERROR",
            details={
                "reason": reason,
                "suggestions": suggestions or [],
            },
        )
        self.symbol = symbol
        self.reason = reason
        self.suggestions = suggestions or []


class RangeValidationError(ValidationError):
    """Error raised when a value is outside expected range."""

    def __init__(
        self,
        field: str,
        value: Any,
        min_value: Optional[Any] = None,
        max_value: Optional[Any] = None,
    ):
        bounds = []
        if min_value is not None:
            bounds.append(f">= {min_value}")
        if max_value is not None:
            bounds.append(f"<= {max_value}")

        message = f"Value {value} for field '{field}' is out of range. Expected: {' and '.join(bounds)}"

        super().__init__(
            message=message,
            field=field,
            value=value,
            code="RANGE_VALIDATION_ERROR",
            details={
                "min_value": min_value,
                "max_value": max_value,
            },
        )
        self.min_value = min_value
        self.max_value = max_value


class TypeValidationError(ValidationError):
    """Error raised when type validation fails."""

    def __init__(
        self,
        field: str,
        value: Any,
        expected_type: str,
        actual_type: str,
    ):
        message = (
            f"Invalid type for field '{field}'. "
            f"Expected {expected_type}, got {actual_type}"
        )
        super().__init__(
            message=message,
            field=field,
            value=value,
            code="TYPE_VALIDATION_ERROR",
            details={
                "expected_type": expected_type,
                "actual_type": actual_type,
            },
        )
        self.expected_type = expected_type
        self.actual_type = actual_type


class AggregateValidationError(ValidationError):
    """Error containing multiple validation errors."""

    def __init__(
        self,
        message: str,
        errors: List[ValidationError],
    ):
        super().__init__(
            message=message,
            code="AGGREGATE_VALIDATION_ERROR",
            details={
                "error_count": len(errors),
                "errors": [e.to_dict() for e in errors],
            },
        )
        self.errors = errors

    def to_dict(self) -> Dict[str, Any]:
        """Convert aggregate error to dictionary."""
        return {
            "code": self.code,
            "message": self.message,
            "error_count": len(self.errors),
            "errors": [e.to_dict() for e in self.errors],
        }
