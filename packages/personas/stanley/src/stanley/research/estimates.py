"""
Analyst estimates - consensus ratings, forward EPS, price targets, and revisions.
"""

from typing import Any


def get_estimates(symbol: str, estimate_type: str = "consensus") -> dict[str, Any]:
    """
    Get analyst estimates for a symbol.

    Args:
        symbol: Stock ticker symbol
        estimate_type: One of "consensus", "forward_eps", "price_target", "revisions"

    Returns:
        {"ok": True, "data": {...}} or {"ok": False, "error": "..."}
    """
    try:
        from openbb import obb

        result_data: dict[str, Any] = {"symbol": symbol.upper(), "type": estimate_type}

        if estimate_type == "consensus":
            res = obb.equity.estimates.consensus(symbol=symbol)
            if res and hasattr(res, "results") and res.results:
                r = res.results[0]
                result_data["consensus"] = {
                    "rating": getattr(r, "rating", None),
                    "target_high": getattr(r, "target_high", None),
                    "target_low": getattr(r, "target_low", None),
                    "target_mean": getattr(r, "target_mean", None),
                    "target_median": getattr(r, "target_median", None),
                    "num_analysts": getattr(r, "num_analysts", None),
                }
            else:
                return {"ok": False, "error": f"No consensus data found for {symbol}"}

        elif estimate_type == "forward_eps":
            res = obb.equity.estimates.forward_eps(symbol=symbol)
            if res and hasattr(res, "results") and res.results:
                result_data["forward_eps"] = [
                    {
                        "period": getattr(e, "period", None),
                        "eps_estimate": getattr(e, "mean", None),
                        "eps_high": getattr(e, "high", None),
                        "eps_low": getattr(e, "low", None),
                        "num_analysts": getattr(e, "num_analysts", None),
                    }
                    for e in res.results[:8]
                ]
            else:
                return {"ok": False, "error": f"No forward EPS data found for {symbol}"}

        elif estimate_type == "price_target":
            res = obb.equity.estimates.price_target(symbol=symbol)
            if res and hasattr(res, "results") and res.results:
                result_data["price_targets"] = [
                    {
                        "analyst": getattr(t, "analyst_name", None),
                        "firm": getattr(t, "analyst_company", None),
                        "rating": getattr(t, "rating", None),
                        "target": getattr(t, "price_target", None),
                        "previous": getattr(t, "previous_price_target", None),
                        "date": str(getattr(t, "published_date", "")),
                    }
                    for t in res.results[:15]
                ]
            else:
                return {"ok": False, "error": f"No price target data found for {symbol}"}

        elif estimate_type == "revisions":
            res = obb.equity.estimates.forward_eps(symbol=symbol)
            if res and hasattr(res, "results") and res.results:
                result_data["revisions"] = [
                    {
                        "period": getattr(e, "period", None),
                        "current_mean": getattr(e, "mean", None),
                        "7d_ago": getattr(e, "mean_7d_ago", None),
                        "30d_ago": getattr(e, "mean_30d_ago", None),
                        "90d_ago": getattr(e, "mean_90d_ago", None),
                    }
                    for e in res.results[:8]
                ]
            else:
                return {"ok": False, "error": f"No revision data found for {symbol}"}

        else:
            return {
                "ok": False,
                "error": f"Unknown estimate_type: {estimate_type}. Use: consensus, forward_eps, price_target, revisions",
            }

        return {"ok": True, "data": result_data}

    except ImportError:
        return {"ok": False, "error": "OpenBB not installed. Run: pip install openbb"}
    except Exception as e:
        return {"ok": False, "error": f"Failed to get estimates for {symbol}: {str(e)}"}
