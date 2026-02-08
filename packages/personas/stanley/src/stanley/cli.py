"""
Stanley CLI - Command line interface for financial research and analysis.
"""

import json
import sys
from typing import Any

import click


def _output_json(data: dict[str, Any]) -> None:
    """Output data as JSON to stdout."""
    click.echo(json.dumps(data, indent=2, default=str))


def _output_result(result: dict[str, Any]) -> None:
    """Output a result, handling errors."""
    if not result.get("ok"):
        click.echo(json.dumps(result), err=True)
        sys.exit(1)
    _output_json(result)


@click.group()
@click.version_option(version="0.1.0", prog_name="stanley")
def main() -> None:
    """Stanley - Financial Research and Market Analysis Assistant."""
    pass


# =============================================================================
# Market Commands
# =============================================================================


@main.group()
def market() -> None:
    """Market data commands."""
    pass


@market.command()
@click.argument("symbol")
def quote(symbol: str) -> None:
    """Get real-time quote for a symbol."""
    from stanley.market.quotes import get_quote

    result = get_quote(symbol)
    _output_result(result)


@market.command()
@click.argument("symbol")
@click.option("--period", "-p", default="1m", help="Time period (1d, 5d, 1m, 3m, 6m, 1y, ytd, max)")
@click.option("--interval", "-i", default="1d", help="Data interval (1m, 5m, 15m, 1h, 1d, 1w)")
def chart(symbol: str, period: str, interval: str) -> None:
    """Get historical price chart."""
    from stanley.market.charts import get_chart

    result = get_chart(symbol, period, interval)
    _output_result(result)


@market.command()
@click.argument("symbol")
def fundamentals(symbol: str) -> None:
    """Get fundamental data for a symbol."""
    from stanley.market.fundamentals import get_fundamentals

    result = get_fundamentals(symbol)
    _output_result(result)


@market.command()
@click.argument("symbol")
@click.option("--type", "-t", "segment_type", default="business",
              help="Segment type (business, geography)")
def segments(symbol: str, segment_type: str) -> None:
    """Get revenue breakdown by business segment or geography."""
    from stanley.market.segments import get_segments

    result = get_segments(symbol, segment_type)
    _output_result(result)


# =============================================================================
# Portfolio Commands
# =============================================================================


@main.group()
def portfolio() -> None:
    """Portfolio management commands."""
    pass


@portfolio.command()
def status() -> None:
    """Get current portfolio status."""
    from stanley.portfolio.tracker import get_portfolio

    result = get_portfolio()
    _output_result(result)


@portfolio.command()
@click.option("--period", "-p", default="ytd", help="Analysis period")
def performance(period: str) -> None:
    """Get portfolio performance metrics."""
    from stanley.portfolio.performance import get_performance

    result = get_performance(period)
    _output_result(result)


@portfolio.command()
@click.option("--var", "-v", default=0.95, help="VaR confidence level (0.95 = 95%%)")
def risk(var: float) -> None:
    """Calculate portfolio risk metrics."""
    from stanley.portfolio.risk import calculate_risk_metrics

    result = calculate_risk_metrics(var)
    _output_result(result)


@portfolio.command()
@click.argument("symbol")
@click.argument("shares", type=float)
@click.argument("cost_basis", type=float)
def add(symbol: str, shares: float, cost_basis: float) -> None:
    """Add a position to the portfolio."""
    from stanley.portfolio.tracker import add_position

    result = add_position(symbol, shares, cost_basis)
    _output_result(result)


@portfolio.command()
@click.argument("symbol")
def remove(symbol: str) -> None:
    """Remove a position from the portfolio."""
    from stanley.portfolio.tracker import remove_position

    result = remove_position(symbol)
    _output_result(result)


# =============================================================================
# Research Commands
# =============================================================================


@main.group()
def research() -> None:
    """Research and analysis commands."""
    pass


@research.command()
@click.argument("ticker")
@click.option("--type", "-t", "form_type", default="10-K", help="Form type (10-K, 10-Q, 8-K, etc.)")
def sec(ticker: str, form_type: str) -> None:
    """Get SEC filing for a company."""
    from stanley.research.sec import get_sec_filing

    result = get_sec_filing(ticker, form_type)
    _output_result(result)


@research.command()
@click.argument("ticker")
@click.option("--type", "-t", "form_type", default="all", help="Filter by form type")
@click.option("--limit", "-l", default=10, help="Maximum results")
def filings(ticker: str, form_type: str, limit: int) -> None:
    """List SEC filings for a company."""
    from stanley.research.sec import list_sec_filings

    result = list_sec_filings(ticker, form_type, limit)
    _output_result(result)


@research.command()
@click.argument("ticker")
@click.option("--filing", "-f", default="10-K", help="Filing type to analyze")
def analyze(ticker: str, filing: str) -> None:
    """Analyze a company using fundamentals and filings."""
    from stanley.research.analysis import analyze_company

    result = analyze_company(ticker, filing)
    _output_result(result)


@research.command()
@click.option("--criteria", "-c", required=True, help="Screening criteria")
def screen(criteria: str) -> None:
    """Screen stocks based on criteria."""
    from stanley.research.screen import screen_stocks

    result = screen_stocks(criteria)
    _output_result(result)


@research.command()
@click.argument("ticker")
@click.option("--type", "-t", "estimate_type", default="consensus",
              help="Estimate type (consensus, forward_eps, price_target, revisions)")
def estimates(ticker: str, estimate_type: str) -> None:
    """Get analyst estimates for a company."""
    from stanley.research.estimates import get_estimates

    result = get_estimates(ticker, estimate_type)
    _output_result(result)


@research.command("insider-trades")
@click.argument("ticker")
@click.option("--limit", "-l", default=20, help="Maximum transactions to return")
def insider_trades(ticker: str, limit: int) -> None:
    """Get insider trading activity for a company."""
    from stanley.research.insider_trades import get_insider_trades

    result = get_insider_trades(ticker, limit)
    _output_result(result)


# =============================================================================
# Nautilus Commands
# =============================================================================


@main.group()
def nautilus() -> None:
    """NautilusTrader backtesting and paper trading."""
    pass


@nautilus.command()
def strategies() -> None:
    """List available trading strategies."""
    from stanley.nautilus.backtest import list_strategies

    result = list_strategies()
    _output_result(result)


@nautilus.command()
@click.argument("strategy")
@click.option("--symbols", "-s", required=True, help="Comma-separated symbols")
@click.option("--start", required=True, help="Start date (YYYY-MM-DD)")
@click.option("--end", default=None, help="End date (YYYY-MM-DD)")
def backtest(strategy: str, symbols: str, start: str, end: str | None) -> None:
    """Run a backtest with a strategy."""
    from stanley.nautilus.backtest import run_backtest

    symbol_list = [s.strip().upper() for s in symbols.split(",")]
    result = run_backtest(strategy, symbol_list, start, end)
    _output_result(result)


@nautilus.command("paper-trade")
@click.argument("strategy")
@click.option("--symbols", "-s", required=True, help="Comma-separated symbols")
@click.option("--capital", "-c", default=100000.0, help="Starting capital")
def paper_trade(strategy: str, symbols: str, capital: float) -> None:
    """Start paper trading simulation."""
    from stanley.nautilus.paper_trade import start_paper_trading

    symbol_list = [s.strip().upper() for s in symbols.split(",")]
    result = start_paper_trading(strategy, symbol_list, capital)
    _output_result(result)


@nautilus.command("paper-stop")
def paper_stop() -> None:
    """Stop paper trading simulation."""
    from stanley.nautilus.paper_trade import stop_paper_trading

    result = stop_paper_trading()
    _output_result(result)


@nautilus.command("paper-status")
def paper_status() -> None:
    """Get paper trading status."""
    from stanley.nautilus.paper_trade import get_paper_status

    result = get_paper_status()
    _output_result(result)


@nautilus.command("strategy-info")
@click.argument("strategy")
def strategy_info(strategy: str) -> None:
    """Get details about a strategy."""
    from stanley.nautilus.backtest import BUILTIN_STRATEGIES

    strategy_lower = strategy.lower()
    if strategy_lower in BUILTIN_STRATEGIES:
        _output_result(
            {
                "ok": True,
                "data": {"id": strategy_lower, **BUILTIN_STRATEGIES[strategy_lower]},
            }
        )
    else:
        _output_result(
            {
                "ok": False,
                "error": f"Unknown strategy: {strategy}. Available: {', '.join(BUILTIN_STRATEGIES.keys())}",
            }
        )


# =============================================================================
# Status Command
# =============================================================================


@main.command()
def status() -> None:
    """Check Stanley health and configuration."""
    import os

    status_data: dict[str, Any] = {
        "ok": True,
        "version": "0.1.0",
        "python_version": sys.version,
        "dependencies": {},
    }

    # Check OpenBB
    try:
        import openbb

        status_data["dependencies"]["openbb"] = {"installed": True, "version": getattr(openbb, "__version__", "unknown")}
    except ImportError:
        status_data["dependencies"]["openbb"] = {"installed": False}

    # Check NautilusTrader
    try:
        import nautilus_trader  # type: ignore

        status_data["dependencies"]["nautilus_trader"] = {
            "installed": True,
            "version": getattr(nautilus_trader, "__version__", "unknown"),
        }
    except ImportError:
        status_data["dependencies"]["nautilus_trader"] = {"installed": False}

    # Check pandas/numpy
    try:
        import pandas
        import numpy

        status_data["dependencies"]["pandas"] = {"installed": True, "version": pandas.__version__}
        status_data["dependencies"]["numpy"] = {"installed": True, "version": numpy.__version__}
    except ImportError as e:
        status_data["dependencies"]["core"] = {"installed": False, "error": str(e)}

    # Portfolio file
    from stanley.portfolio.tracker import _get_portfolio_path

    portfolio_path = _get_portfolio_path()
    status_data["portfolio_file"] = str(portfolio_path)
    status_data["portfolio_exists"] = portfolio_path.exists()

    _output_result({"ok": True, "data": status_data})


if __name__ == "__main__":
    main()
