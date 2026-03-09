"""
Accounting Router

SEC filings analysis, earnings quality scoring, red flag detection,
and anomaly analysis endpoints using edgartools.

Rate limited to 10 requests/minute for SEC EDGAR courtesy.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from investing.api.routers.base import get_app_state
from investing.api.auth.rate_limit import RateLimitDependency

logger = logging.getLogger(__name__)


# =============================================================================
# Rate Limiting (SEC EDGAR courtesy)
# =============================================================================

# Rate limit dependency for accounting endpoints (10/min - SEC EDGAR courtesy)
accounting_rate_limit = RateLimitDependency(
    requests=10, window=60, category="accounting"
)


# =============================================================================
# Response Models
# =============================================================================


class RedFlagItem(BaseModel):
    """Individual red flag detected."""

    category: str
    description: str
    severity: str
    metric: Optional[str] = None
    value: Optional[float] = None
    threshold: Optional[float] = None


class RedFlagResponse(BaseModel):
    """Red flag analysis response."""

    symbol: str
    totalScore: float
    riskLevel: str
    redFlags: List[RedFlagItem]
    categorySummary: Dict[str, int]
    timestamp: str


class AnomalyItem(BaseModel):
    """Individual anomaly detected."""

    type: str
    description: str
    severity: str
    metric: Optional[str] = None
    value: Optional[float] = None
    expectedRange: Optional[List[float]] = None


class AnomalyResponse(BaseModel):
    """Anomaly detection response."""

    symbol: str
    totalAnomalies: int
    anomalies: List[AnomalyItem]
    benfordScore: Optional[float] = None
    disclosureQuality: Optional[float] = None
    timestamp: str


class EarningsQualityResponse(BaseModel):
    """Earnings quality analysis response."""

    symbol: str
    overallRating: str
    overallScore: float
    mScore: Optional[float] = None
    mScoreRisk: Optional[str] = None
    isLikelyManipulator: bool = False
    fScore: Optional[int] = None
    fScoreCategory: Optional[str] = None
    zScore: Optional[float] = None
    zScoreZone: Optional[str] = None
    accrualRatio: Optional[float] = None
    cashConversion: Optional[float] = None
    earningsPersistence: Optional[float] = None
    redFlags: List[str] = []
    timestamp: str


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    timestamp: str


# =============================================================================
# Router Setup
# =============================================================================

router = APIRouter(prefix="/api/accounting", tags=["Accounting Quality"])


def get_timestamp() -> str:
    """Get current ISO timestamp."""
    return datetime.utcnow().isoformat() + "Z"


def create_response(
    data: Any = None, error: Optional[str] = None, success: bool = True
) -> ApiResponse:
    """Create a standardized API response."""
    return ApiResponse(
        success=success and error is None,
        data=data,
        error=error,
        timestamp=get_timestamp(),
    )


# =============================================================================
# Earnings Quality Endpoints
# =============================================================================


@router.get(
    "/earnings-quality/{symbol}",
    response_model=ApiResponse,
    summary="Comprehensive earnings quality analysis",
    description="""
    Get comprehensive earnings quality analysis for a symbol.

    Includes:
    - Beneish M-Score (earnings manipulation detection)
    - Piotroski F-Score (financial strength)
    - Altman Z-Score (bankruptcy risk)
    - Accrual analysis
    """,
)
async def get_earnings_quality(
    symbol: str,
    manufacturing: bool = Query(
        False, description="Use manufacturing-specific Z-Score formula"
    ),
    _rate_limit: None = Depends(accounting_rate_limit),
):
    """Get comprehensive earnings quality analysis for a symbol."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.earnings_quality_analyzer:
            raise HTTPException(
                status_code=503, detail="Earnings quality analyzer not initialized"
            )

        result = app_state.earnings_quality_analyzer.analyze(
            symbol, manufacturing=manufacturing
        )

        return create_response(
            data={
                "symbol": symbol,
                "overallRating": (
                    result.overall_rating.value
                    if hasattr(result.overall_rating, "value")
                    else str(result.overall_rating)
                ),
                "overallScore": result.overall_score,
                "mScore": result.m_score.m_score if result.m_score else None,
                "mScoreRisk": (
                    result.m_score.risk_level.value
                    if result.m_score and hasattr(result.m_score.risk_level, "value")
                    else None
                ),
                "isLikelyManipulator": (
                    result.m_score.is_likely_manipulator if result.m_score else False
                ),
                "fScore": result.f_score.f_score if result.f_score else None,
                "fScoreCategory": (result.f_score.category if result.f_score else None),
                "zScore": result.z_score.z_score if result.z_score else None,
                "zScoreZone": result.z_score.zone if result.z_score else None,
                "accrualRatio": result.accrual_ratio,
                "cashConversion": result.cash_conversion,
                "earningsPersistence": result.earnings_persistence,
                "redFlags": result.red_flags,
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing earnings quality for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/m-score/{symbol}",
    response_model=ApiResponse,
    summary="Beneish M-Score analysis",
    description="""
    Get Beneish M-Score analysis for earnings manipulation detection.

    - M-Score < -2.22: Low manipulation risk
    - M-Score > -2.22: Higher manipulation risk
    - M-Score > -1.78: Likely manipulator
    """,
)
async def get_beneish_m_score(
    symbol: str,
    _rate_limit: None = Depends(accounting_rate_limit),
):
    """Get Beneish M-Score for earnings manipulation detection."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.earnings_quality_analyzer:
            raise HTTPException(
                status_code=503, detail="Earnings quality analyzer not initialized"
            )

        result = app_state.earnings_quality_analyzer.m_score_calc.calculate(symbol)

        return create_response(
            data={
                "symbol": symbol,
                "mScore": result.m_score,
                "isLikelyManipulator": result.is_likely_manipulator,
                "components": result.components,
                "riskLevel": result.risk_level.value,
                "threshold": -1.78,
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating M-Score for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/f-score/{symbol}",
    response_model=ApiResponse,
    summary="Piotroski F-Score analysis",
    description="""
    Get Piotroski F-Score for financial strength assessment.

    - F-Score 8-9: Strong fundamentals
    - F-Score 5-7: Neutral
    - F-Score 0-4: Weak fundamentals
    """,
)
async def get_piotroski_f_score(
    symbol: str,
    _rate_limit: None = Depends(accounting_rate_limit),
):
    """Get Piotroski F-Score for financial strength assessment."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.earnings_quality_analyzer:
            raise HTTPException(
                status_code=503, detail="Earnings quality analyzer not initialized"
            )

        result = app_state.earnings_quality_analyzer.f_score_calc.calculate(symbol)

        return create_response(
            data={
                "symbol": symbol,
                "fScore": result.f_score,
                "category": result.category,
                "signals": result.signals,
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating F-Score for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/z-score/{symbol}",
    response_model=ApiResponse,
    summary="Altman Z-Score analysis",
    description="""
    Get Altman Z-Score for bankruptcy risk assessment.

    Manufacturing formula:
    - Z > 2.99: Safe zone
    - 1.81-2.99: Gray zone
    - Z < 1.81: Distress zone

    Service/non-manufacturing formula:
    - Z' > 2.6: Safe zone
    - 1.1-2.6: Gray zone
    - Z' < 1.1: Distress zone
    """,
)
async def get_altman_z_score(
    symbol: str,
    manufacturing: bool = Query(
        False, description="Use manufacturing formula (default: service)"
    ),
    _rate_limit: None = Depends(accounting_rate_limit),
):
    """Get Altman Z-Score for bankruptcy risk assessment."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.earnings_quality_analyzer:
            raise HTTPException(
                status_code=503, detail="Earnings quality analyzer not initialized"
            )

        result = app_state.earnings_quality_analyzer.z_score_calc.calculate(
            symbol, manufacturing=manufacturing
        )

        return create_response(
            data={
                "symbol": symbol,
                "zScore": result.z_score,
                "zone": result.zone,
                "components": result.components,
                "formulaType": "manufacturing" if manufacturing else "service",
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating Z-Score for {symbol}: {e}")
        return create_response(error=str(e), success=False)


# =============================================================================
# Red Flag Detection Endpoints
# =============================================================================


@router.get(
    "/red-flags/{symbol}",
    response_model=ApiResponse,
    summary="Red flag analysis",
    description="""
    Get comprehensive red flag analysis for a symbol.

    Detects:
    - Revenue manipulation indicators
    - Expense irregularities
    - Accrual quality issues
    - Off-balance-sheet concerns
    - Cash flow anomalies
    """,
)
async def get_red_flags(
    symbol: str,
    _rate_limit: None = Depends(accounting_rate_limit),
):
    """Get comprehensive red flag analysis for a symbol."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.red_flag_scorer:
            raise HTTPException(
                status_code=503, detail="Red flag scorer not initialized"
            )

        result = app_state.red_flag_scorer.score(symbol)

        # Convert red flags to serializable format
        flags_data = []
        for flag in result.red_flags:
            flags_data.append(
                {
                    "category": flag.category,
                    "description": flag.description,
                    "severity": (
                        flag.severity.value
                        if hasattr(flag.severity, "value")
                        else str(flag.severity)
                    ),
                    "metric": flag.metric,
                    "value": flag.value,
                    "threshold": flag.threshold,
                }
            )

        return create_response(
            data={
                "symbol": symbol,
                "totalScore": result.total_score,
                "riskLevel": result.risk_level,
                "redFlags": flags_data,
                "categorySummary": result.category_summary,
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing red flags for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/red-flags/{symbol}/peers",
    response_model=ApiResponse,
    summary="Red flag peer comparison",
    description="Compare red flags against peer companies.",
)
async def get_red_flags_peer_comparison(
    symbol: str,
    peers: Optional[str] = Query(
        None, description="Comma-separated peer symbols (auto-detected if not provided)"
    ),
    _rate_limit: None = Depends(accounting_rate_limit),
):
    """Compare red flags against peer companies."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.red_flag_scorer:
            raise HTTPException(
                status_code=503, detail="Red flag scorer not initialized"
            )

        peer_list = peers.split(",") if peers else None
        comparison = app_state.red_flag_scorer.compare_peer_red_flags(symbol, peer_list)

        if comparison.empty:
            return create_response(data={"symbol": symbol, "comparison": {}})

        return create_response(
            data={
                "symbol": symbol,
                "comparison": comparison.to_dict(orient="index"),
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error comparing red flags for {symbol}: {e}")
        return create_response(error=str(e), success=False)


# =============================================================================
# Anomaly Detection Endpoints
# =============================================================================


@router.get(
    "/anomalies/{symbol}",
    response_model=ApiResponse,
    summary="Anomaly detection analysis",
    description="""
    Get comprehensive anomaly detection analysis for a symbol.

    Includes:
    - Time-series anomalies
    - Benford's Law analysis
    - Peer comparison anomalies
    - Footnote analysis
    - Disclosure quality scoring
    - Seasonal patterns
    """,
)
async def get_anomalies(
    symbol: str,
    _rate_limit: None = Depends(accounting_rate_limit),
):
    """Get comprehensive anomaly detection analysis for a symbol."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.anomaly_aggregator:
            raise HTTPException(
                status_code=503, detail="Anomaly aggregator not initialized"
            )

        result = app_state.anomaly_aggregator.detect_all_anomalies(symbol)

        # Convert anomalies to serializable format
        anomalies_data = []
        for anomaly in result.anomalies:
            anomalies_data.append(
                {
                    "type": anomaly.anomaly_type,
                    "description": anomaly.description,
                    "severity": anomaly.severity,
                    "metric": anomaly.metric,
                    "value": anomaly.value,
                    "expectedRange": anomaly.expected_range,
                }
            )

        return create_response(
            data={
                "symbol": symbol,
                "totalAnomalies": len(result.anomalies),
                "anomalies": anomalies_data,
                "benfordScore": result.benford_score,
                "disclosureQuality": result.disclosure_quality,
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error detecting anomalies for {symbol}: {e}")
        return create_response(error=str(e), success=False)


# =============================================================================
# Accrual Analysis Endpoints
# =============================================================================


@router.get(
    "/accruals/{symbol}",
    response_model=ApiResponse,
    summary="Accrual analysis",
    description="""
    Get detailed accrual analysis for a symbol.

    Includes:
    - Sloan accrual ratio
    - Richardson decomposition
    - Working capital accruals
    - Cash conversion quality
    """,
)
async def get_accrual_analysis(
    symbol: str,
    _rate_limit: None = Depends(accounting_rate_limit),
):
    """Get detailed accrual analysis for a symbol."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.earnings_quality_analyzer:
            raise HTTPException(
                status_code=503, detail="Earnings quality analyzer not initialized"
            )

        accrual_ratio = (
            app_state.earnings_quality_analyzer.accrual_calc.calculate_accrual_ratio(
                symbol
            )
        )
        cash_conversion = (
            app_state.earnings_quality_analyzer.accrual_calc.calculate_cash_conversion(
                symbol
            )
        )

        # Flag high accruals (>10%) as lower quality
        quality_flag = (
            abs(accrual_ratio) > 0.10 if not np.isnan(accrual_ratio) else False
        )

        return create_response(
            data={
                "symbol": symbol,
                "accrualRatio": accrual_ratio if not np.isnan(accrual_ratio) else None,
                "cashConversion": (
                    cash_conversion if not np.isnan(cash_conversion) else None
                ),
                "qualityFlag": quality_flag,
                "interpretation": (
                    "High accruals may indicate lower earnings quality"
                    if quality_flag
                    else "Accrual levels within normal range"
                ),
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing accruals for {symbol}: {e}")
        return create_response(error=str(e), success=False)


# =============================================================================
# Comprehensive Analysis Endpoint
# =============================================================================


@router.get(
    "/comprehensive/{symbol}",
    response_model=ApiResponse,
    summary="Comprehensive accounting quality report",
    description="""
    Get comprehensive accounting quality report combining all analyses.

    This is the primary endpoint for full fundamental quality analysis.
    Includes earnings quality, red flags, anomalies, and overall assessment.
    """,
)
async def get_comprehensive_accounting_quality(
    symbol: str,
    manufacturing: bool = Query(
        False, description="Use manufacturing-specific formulas"
    ),
    _rate_limit: None = Depends(accounting_rate_limit),
):
    """Get comprehensive accounting quality report."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        # Collect all available analyses
        report = {"symbol": symbol, "timestamp": get_timestamp()}

        # Earnings Quality
        if app_state.earnings_quality_analyzer:
            try:
                eq_result = app_state.earnings_quality_analyzer.analyze(
                    symbol, manufacturing=manufacturing
                )
                report["earningsQuality"] = {
                    "overallRating": (
                        eq_result.overall_rating.value
                        if hasattr(eq_result.overall_rating, "value")
                        else str(eq_result.overall_rating)
                    ),
                    "overallScore": eq_result.overall_score,
                    "mScore": {
                        "score": (
                            eq_result.m_score.m_score if eq_result.m_score else None
                        ),
                        "riskLevel": (
                            eq_result.m_score.risk_level.value
                            if eq_result.m_score
                            else None
                        ),
                        "isLikelyManipulator": (
                            eq_result.m_score.is_likely_manipulator
                            if eq_result.m_score
                            else False
                        ),
                    },
                    "fScore": {
                        "score": (
                            eq_result.f_score.f_score if eq_result.f_score else None
                        ),
                        "category": (
                            eq_result.f_score.category if eq_result.f_score else None
                        ),
                    },
                    "zScore": {
                        "score": (
                            eq_result.z_score.z_score if eq_result.z_score else None
                        ),
                        "zone": eq_result.z_score.zone if eq_result.z_score else None,
                    },
                    "accrualRatio": eq_result.accrual_ratio,
                    "cashConversion": eq_result.cash_conversion,
                    "redFlags": eq_result.red_flags,
                }
            except Exception as e:
                logger.warning(f"Earnings quality analysis failed: {e}")
                report["earningsQuality"] = {"error": str(e)}

        # Red Flags
        if app_state.red_flag_scorer:
            try:
                rf_result = app_state.red_flag_scorer.score(symbol)
                flags_data = []
                for flag in rf_result.red_flags:
                    flags_data.append(
                        {
                            "category": flag.category,
                            "description": flag.description,
                            "severity": (
                                flag.severity.value
                                if hasattr(flag.severity, "value")
                                else str(flag.severity)
                            ),
                        }
                    )
                report["redFlags"] = {
                    "totalScore": rf_result.total_score,
                    "riskLevel": rf_result.risk_level,
                    "flagCount": len(rf_result.red_flags),
                    "flags": flags_data[:10],  # Top 10 flags
                    "categorySummary": rf_result.category_summary,
                }
            except Exception as e:
                logger.warning(f"Red flag analysis failed: {e}")
                report["redFlags"] = {"error": str(e)}

        # Anomalies
        if app_state.anomaly_aggregator:
            try:
                an_result = app_state.anomaly_aggregator.detect_all_anomalies(symbol)
                anomalies_data = []
                for anomaly in an_result.anomalies[:10]:  # Top 10 anomalies
                    anomalies_data.append(
                        {
                            "type": anomaly.anomaly_type,
                            "description": anomaly.description,
                            "severity": anomaly.severity,
                        }
                    )
                report["anomalies"] = {
                    "totalCount": len(an_result.anomalies),
                    "benfordScore": an_result.benford_score,
                    "disclosureQuality": an_result.disclosure_quality,
                    "anomalies": anomalies_data,
                }
            except Exception as e:
                logger.warning(f"Anomaly detection failed: {e}")
                report["anomalies"] = {"error": str(e)}

        # Overall Assessment
        quality_score = 100
        risk_factors = []

        # Deduct for M-Score risk
        if "earningsQuality" in report and "error" not in report["earningsQuality"]:
            eq = report["earningsQuality"]
            if eq.get("mScore", {}).get("riskLevel") == "High":
                quality_score -= 30
                risk_factors.append("High earnings manipulation risk (M-Score)")
            elif eq.get("mScore", {}).get("riskLevel") == "Moderate":
                quality_score -= 15
                risk_factors.append("Moderate earnings manipulation risk")

            # Deduct for weak F-Score
            if eq.get("fScore", {}).get("score", 9) <= 3:
                quality_score -= 25
                risk_factors.append("Weak financial fundamentals (F-Score)")
            elif eq.get("fScore", {}).get("score", 9) <= 5:
                quality_score -= 10

            # Deduct for distress zone
            if eq.get("zScore", {}).get("zone") == "Distress":
                quality_score -= 30
                risk_factors.append("High bankruptcy risk (Z-Score)")
            elif eq.get("zScore", {}).get("zone") == "Gray Zone":
                quality_score -= 15

        # Deduct for red flags
        if "redFlags" in report and "error" not in report["redFlags"]:
            rf = report["redFlags"]
            if rf.get("riskLevel") == "Critical":
                quality_score -= 30
                risk_factors.append("Critical red flags detected")
            elif rf.get("riskLevel") == "High":
                quality_score -= 20
                risk_factors.append("High red flag risk")
            elif rf.get("riskLevel") == "Medium":
                quality_score -= 10

        # Deduct for anomalies
        if "anomalies" in report and "error" not in report["anomalies"]:
            an = report["anomalies"]
            if an.get("totalCount", 0) > 10:
                quality_score -= 15
                risk_factors.append("High number of financial anomalies")
            elif an.get("totalCount", 0) > 5:
                quality_score -= 8

        quality_score = max(0, min(100, quality_score))

        if quality_score >= 80:
            overall_rating = "Excellent"
        elif quality_score >= 60:
            overall_rating = "Good"
        elif quality_score >= 40:
            overall_rating = "Fair"
        elif quality_score >= 20:
            overall_rating = "Poor"
        else:
            overall_rating = "Critical"

        report["overallAssessment"] = {
            "qualityScore": quality_score,
            "rating": overall_rating,
            "riskFactors": risk_factors,
        }

        return create_response(data=report)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating comprehensive report for {symbol}: {e}")
        return create_response(error=str(e), success=False)


# =============================================================================
# Audit Fee Analysis (Additional endpoint per requirements)
# =============================================================================


@router.get(
    "/audit-fees/{symbol}",
    response_model=ApiResponse,
    summary="Audit fee analysis",
    description="""
    Analyze audit fees and auditor changes for potential red flags.

    High audit fees relative to peers or sudden changes may indicate
    increased audit complexity or management concerns.
    """,
)
async def get_audit_fees(
    symbol: str,
    _rate_limit: None = Depends(accounting_rate_limit),
):
    """Get audit fee analysis for a symbol."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        # Audit fees would typically come from proxy statements (DEF 14A)
        # This is a placeholder implementation
        if not app_state.accounting_analyzer:
            raise HTTPException(
                status_code=503, detail="Accounting analyzer not initialized"
            )

        # Mock response - in production would fetch from SEC filings
        return create_response(
            data={
                "symbol": symbol,
                "auditFees": {
                    "currentYear": None,
                    "priorYear": None,
                    "change": None,
                    "changePercent": None,
                },
                "auditorInfo": {
                    "name": None,
                    "tenure": None,
                    "recentChange": False,
                },
                "peerComparison": {
                    "medianAuditFees": None,
                    "percentile": None,
                },
                "redFlags": [],
                "note": "Audit fee data requires DEF 14A proxy statement parsing",
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing audit fees for {symbol}: {e}")
        return create_response(error=str(e), success=False)


# =============================================================================
# SEC Filings List (Additional endpoint per requirements)
# =============================================================================


@router.get(
    "/filings/{symbol}",
    response_model=ApiResponse,
    summary="SEC filings list",
    description="Get list of recent SEC filings for a symbol.",
)
async def get_sec_filings(
    symbol: str,
    form_type: Optional[str] = Query(
        None, description="Filter by form type (10-K, 10-Q, 8-K, etc.)"
    ),
    limit: int = Query(20, ge=1, le=100, description="Maximum filings to return"),
    _rate_limit: None = Depends(accounting_rate_limit),
):
    """Get list of SEC filings for a symbol."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.accounting_analyzer:
            raise HTTPException(
                status_code=503, detail="Accounting analyzer not initialized"
            )

        # Get filings from Edgar adapter
        filings = app_state.accounting_analyzer.get_filings(
            symbol, form_type=form_type, limit=limit
        )

        return create_response(
            data={
                "symbol": symbol,
                "filings": filings,
                "count": len(filings) if filings else 0,
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching filings for {symbol}: {e}")
        return create_response(error=str(e), success=False)


# =============================================================================
# Financial Statements (Additional endpoint per requirements)
# =============================================================================


@router.get(
    "/statements/{symbol}",
    response_model=ApiResponse,
    summary="Financial statements",
    description="Get parsed financial statements from SEC filings.",
)
async def get_financial_statements(
    symbol: str,
    statement_type: Optional[str] = Query(
        None,
        description="Statement type: income, balance_sheet, cash_flow, or all",
    ),
    periods: int = Query(4, ge=1, le=20, description="Number of periods to return"),
    _rate_limit: None = Depends(accounting_rate_limit),
):
    """Get financial statements for a symbol."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.accounting_analyzer:
            raise HTTPException(
                status_code=503, detail="Accounting analyzer not initialized"
            )

        # Get statements from accounting analyzer
        statements = app_state.accounting_analyzer.get_statements(
            symbol, statement_type=statement_type, periods=periods
        )

        return create_response(
            data={
                "symbol": symbol,
                "statements": statements,
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching statements for {symbol}: {e}")
        return create_response(error=str(e), success=False)
