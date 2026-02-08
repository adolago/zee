"""
Insider trading activity via OpenBB ownership endpoints.
"""

from typing import Any


def get_insider_trades(symbol: str, limit: int = 20) -> dict[str, Any]:
    """
    Get recent insider buy/sell transactions.

    Args:
        symbol: Stock ticker symbol
        limit: Max number of transactions to return

    Returns:
        {"ok": True, "data": {...}} or {"ok": False, "error": "..."}
    """
    try:
        from openbb import obb

        res = obb.equity.ownership.insider_trading(symbol=symbol, limit=limit)
        if not (res and hasattr(res, "results") and res.results):
            return {"ok": False, "error": f"No insider trading data found for {symbol}"}

        trades = []
        net_shares = 0
        for t in res.results[:limit]:
            shares = getattr(t, "shares", 0) or 0
            tx_type = getattr(t, "transaction_type", "") or ""

            if "purchase" in tx_type.lower() or "buy" in tx_type.lower():
                net_shares += shares
            elif "sale" in tx_type.lower() or "sell" in tx_type.lower():
                net_shares -= shares

            trades.append(
                {
                    "filing_date": str(getattr(t, "filing_date", "")),
                    "transaction_date": str(getattr(t, "transaction_date", "")),
                    "owner": getattr(t, "owner_name", None),
                    "title": getattr(t, "owner_title", None),
                    "transaction_type": tx_type,
                    "shares": shares,
                    "price": getattr(t, "price", None),
                    "value": getattr(t, "value", None),
                    "shares_owned_after": getattr(t, "shares_owned", None),
                }
            )

        buy_count = sum(
            1
            for t in trades
            if "purchase" in (t.get("transaction_type") or "").lower()
            or "buy" in (t.get("transaction_type") or "").lower()
        )
        sell_count = sum(
            1
            for t in trades
            if "sale" in (t.get("transaction_type") or "").lower()
            or "sell" in (t.get("transaction_type") or "").lower()
        )

        return {
            "ok": True,
            "data": {
                "symbol": symbol.upper(),
                "count": len(trades),
                "summary": {
                    "buy_transactions": buy_count,
                    "sell_transactions": sell_count,
                    "net_shares": net_shares,
                    "sentiment": "bullish"
                    if net_shares > 0
                    else "bearish"
                    if net_shares < 0
                    else "neutral",
                },
                "trades": trades,
            },
        }

    except ImportError:
        return {"ok": False, "error": "OpenBB not installed. Run: pip install openbb"}
    except Exception as e:
        return {"ok": False, "error": f"Failed to get insider trades for {symbol}: {str(e)}"}
