"""
Business segment and geographic revenue breakdown via OpenBB.
"""

from typing import Any


def get_segments(symbol: str, segment_type: str = "business") -> dict[str, Any]:
    """
    Get revenue breakdown by segment or geography.

    Args:
        symbol: Stock ticker symbol
        segment_type: "business" for product/service segments, "geography" for regional

    Returns:
        {"ok": True, "data": {...}} or {"ok": False, "error": "..."}
    """
    try:
        from openbb import obb

        if segment_type == "geography":
            res = obb.equity.fundamental.revenue_per_geography(symbol=symbol)
        elif segment_type == "business":
            res = obb.equity.fundamental.revenue_per_segment(symbol=symbol)
        else:
            return {
                "ok": False,
                "error": f"Unknown segment_type: {segment_type}. Use: business, geography",
            }

        if not (res and hasattr(res, "results") and res.results):
            return {"ok": False, "error": f"No segment data found for {symbol}"}

        # Group by period
        periods: dict[str, dict[str, Any]] = {}
        for entry in res.results:
            period = str(getattr(entry, "period", ""))
            fiscal_year = getattr(entry, "fiscal_year", None)
            key = f"{fiscal_year}_{period}" if fiscal_year else period

            if key not in periods:
                periods[key] = {"period": period, "fiscal_year": fiscal_year, "segments": {}}

            seg_name = (
                getattr(entry, "segment", None)
                or getattr(entry, "geography", None)
                or "unknown"
            )
            revenue = getattr(entry, "revenue", None)
            if seg_name and revenue is not None:
                periods[key]["segments"][seg_name] = revenue

        # Calculate growth rates between consecutive periods
        sorted_periods = sorted(
            periods.values(), key=lambda p: str(p.get("fiscal_year", ""))
        )

        for i in range(1, len(sorted_periods)):
            prev = sorted_periods[i - 1]["segments"]
            curr = sorted_periods[i]["segments"]
            growth = {}
            for seg, rev in curr.items():
                if seg in prev and prev[seg] and prev[seg] > 0:
                    growth[seg] = round((rev - prev[seg]) / prev[seg] * 100, 2)
            sorted_periods[i]["growth_pct"] = growth

        return {
            "ok": True,
            "data": {
                "symbol": symbol.upper(),
                "segment_type": segment_type,
                "periods": sorted_periods[-4:],  # Last 4 periods
            },
        }

    except ImportError:
        return {"ok": False, "error": "OpenBB not installed. Run: pip install openbb"}
    except Exception as e:
        return {"ok": False, "error": f"Failed to get segments for {symbol}: {str(e)}"}
