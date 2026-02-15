#!/usr/bin/env python3
"""
Stanley CLI bridge for agent-core skills (stdio JSON).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional


def _repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))


sys.path.insert(0, _repo_root())


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class PeriodRange:
    start: datetime
    end: datetime


def _period_to_range(period: str) -> PeriodRange:
    now = _utc_now()
    if period == "1d":
        return PeriodRange(now - timedelta(days=1), now)
    if period == "5d":
        return PeriodRange(now - timedelta(days=5), now)
    if period == "1m":
        return PeriodRange(now - timedelta(days=30), now)
    if period == "3m":
        return PeriodRange(now - timedelta(days=90), now)
    if period == "6m":
        return PeriodRange(now - timedelta(days=180), now)
    if period == "1y":
        return PeriodRange(now - timedelta(days=365), now)
    if period == "ytd":
        return PeriodRange(datetime(now.year, 1, 1), now)
    if period == "max":
        return PeriodRange(now - timedelta(days=3650), now)
    return PeriodRange(now - timedelta(days=180), now)


def _json_dump(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, default=str))


def _load_openbb_api_key() -> Optional[str]:
    return (
        os.getenv("OPENBB_API_KEY")
        or os.getenv("OPENBB_PAT")
        or os.getenv("OPENBB_TOKEN")
    )


def _load_openbb_provider() -> str:
    return os.getenv("STANLEY_OPENBB_PROVIDER", "yfinance")


def _format_error(message: str, code: int = 1) -> int:
    _json_dump({"ok": False, "error": message})
    return code


def _chart_bars(adapter, symbol: str, period: str) -> List[Dict[str, Any]]:
    period_range = _period_to_range(period)
    return adapter.get_historical_bars(
        symbol=symbol,
        start_date=period_range.start.strftime("%Y-%m-%d"),
        end_date=period_range.end.strftime("%Y-%m-%d"),
    )


async def _fundamentals(provider, symbol: str) -> Dict[str, Any]:
    await provider.initialize()
    return await provider.get_fundamentals(symbol)


def _load_portfolio_file() -> str:
    default_path = os.path.join(
        os.path.expanduser("~"), ".zee", "stanley", "portfolio.json"
    )
    return os.getenv("STANLEY_PORTFOLIO_FILE", default_path)


def _read_portfolio_holdings() -> List[Dict[str, Any]]:
    path = _load_portfolio_file()
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Portfolio file not found: {path}. Set STANLEY_PORTFOLIO_FILE or create the file."
        )
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError("Portfolio file must be a JSON array of holdings.")
    return data


def _parse_date(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d")


def _parse_symbols(value: str) -> List[str]:
    if not value:
        return []
    return [item.strip().upper() for item in value.split(",") if item.strip()]


def _build_nautilus_strategy(
    strategy_name: str, instrument_id, bar_type, trade_size: Decimal
):
    if strategy_name == "momentum":
        from nautilus_trader.examples.strategies.ema_cross_long_only import (
            EMACrossLongOnly,
            EMACrossLongOnlyConfig,
        )

        config = EMACrossLongOnlyConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
            trade_size=trade_size,
            fast_ema_period=10,
            slow_ema_period=30,
            request_historical_bars=False,
            close_positions_on_stop=True,
        )
        return EMACrossLongOnly(config=config)

    if strategy_name == "mean-reversion":
        from nautilus_trader.config import PositiveInt, StrategyConfig
        from nautilus_trader.indicators.averages import SimpleMovingAverage
        from nautilus_trader.model.enums import OrderSide, TimeInForce
        from nautilus_trader.model.orders import MarketOrder
        from nautilus_trader.trading.strategy import Strategy

        class MeanReversionConfig(StrategyConfig, frozen=True):
            instrument_id: Any
            bar_type: Any
            trade_size: Decimal
            lookback: PositiveInt = 20
            threshold: float = 0.02
            close_positions_on_stop: bool = True

        class MeanReversionStrategy(Strategy):
            def __init__(self, config: MeanReversionConfig) -> None:
                super().__init__(config)
                self.instrument = None
                self.sma = SimpleMovingAverage(config.lookback)

            def on_start(self) -> None:
                self.instrument = self.cache.instrument(self.config.instrument_id)
                if self.instrument is None:
                    self.log.error(f"Instrument not found: {self.config.instrument_id}")
                    self.stop()
                    return
                self.register_indicator_for_bars(self.config.bar_type, self.sma)
                self.subscribe_bars(self.config.bar_type)

            def on_bar(self, bar) -> None:
                if not self.sma.initialized:
                    return
                price = float(bar.close)
                avg = float(self.sma.value)
                if avg <= 0:
                    return
                lower = avg * (1.0 - self.config.threshold)
                if self.portfolio.is_flat(self.config.instrument_id):
                    if price < lower:
                        order: MarketOrder = self.order_factory.market(
                            instrument_id=self.config.instrument_id,
                            order_side=OrderSide.BUY,
                            quantity=self.instrument.make_qty(self.config.trade_size),
                            time_in_force=TimeInForce.IOC,
                        )
                        self.submit_order(order)
                elif self.portfolio.is_net_long(self.config.instrument_id):
                    if price >= avg:
                        self.close_all_positions(self.config.instrument_id)

            def on_stop(self) -> None:
                self.cancel_all_orders(self.config.instrument_id)
                if self.config.close_positions_on_stop:
                    self.close_all_positions(self.config.instrument_id)
                self.unsubscribe_bars(self.config.bar_type)

        config = MeanReversionConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
            trade_size=trade_size,
        )
        return MeanReversionStrategy(config=config)

    raise ValueError(f"Unknown strategy: {strategy_name}")


def _nautilus_backtest(
    strategy_name: str,
    symbols: List[str],
    start_date: datetime,
    end_date: datetime,
    initial_capital: float,
    provider_name: str,
    api_key: Optional[str],
) -> Dict[str, Any]:
    from nautilus_trader.backtest.engine import BacktestEngine, BacktestEngineConfig
    from nautilus_trader.backtest.models import FillModel, LatencyModel
    from nautilus_trader.config import LoggingConfig
    from nautilus_trader.model.currencies import USD
    from nautilus_trader.model.enums import (
        AccountType,
        AggregationSource,
        BarAggregation,
        OmsType,
        PriceType,
        OrderStatus,
    )
    from nautilus_trader.model.identifiers import TraderId, Venue
    from nautilus_trader.model.objects import Money
    from nautilus_trader.model.data import BarSpecification, BarType

    from stanley.data.providers.openbb_provider import OpenBBAdapter
    from stanley.integrations.nautilus import (
        OpenBBBarConverter,
        OpenBBInstrumentProvider,
        InstrumentConfig,
    )

    if not symbols:
        symbols = ["AAPL"]

    openbb_adapter = OpenBBAdapter({"provider": provider_name, "api_key": api_key})
    instrument_provider = OpenBBInstrumentProvider(venue="OPENBB")

    instruments: Dict[str, Any] = {}
    bar_types: Dict[str, Any] = {}
    bars_by_symbol: Dict[str, List[Any]] = {}

    for symbol in symbols:
        instrument_config = InstrumentConfig(
            symbol=symbol,
            asset_class="EQUITY",
            currency=USD,
            exchange="NASDAQ",
            tick_size=0.01,
            lot_size=1.0,
        )
        instrument = instrument_provider.create_equity(instrument_config)
        instruments[symbol] = instrument

        df = openbb_adapter.get_historical_data(
            symbol=symbol,
            start_date=start_date.strftime("%Y-%m-%d"),
            end_date=end_date.strftime("%Y-%m-%d"),
        )
        if df.empty:
            continue

        bar_spec = BarSpecification(1, BarAggregation.DAY, PriceType.LAST)
        bar_type = BarType(
            instrument_id=instrument.id,
            bar_spec=bar_spec,
            aggregation_source=AggregationSource.EXTERNAL,
        )
        bar_types[symbol] = bar_type

        converter = OpenBBBarConverter(
            instrument_id=instrument.id,
            bar_type=bar_type,
            price_precision=2,
            size_precision=0,
        )
        bars = converter.convert_dataframe(df)
        if bars:
            bars_by_symbol[symbol] = bars

    engine_config = BacktestEngineConfig(
        trader_id=TraderId("STANLEY-BACKTEST"),
        logging=LoggingConfig(log_level="ERROR", log_colors=False, bypass_logging=True),
    )
    engine = BacktestEngine(config=engine_config)

    venue = Venue("OPENBB")
    engine.add_venue(
        venue=venue,
        oms_type=OmsType.HEDGING,
        account_type=AccountType.CASH,
        base_currency=USD,
        starting_balances=[Money(initial_capital, USD)],
        fill_model=FillModel(),
        latency_model=LatencyModel(),
    )

    for instrument in instruments.values():
        engine.add_instrument(instrument)

    for bar_list in bars_by_symbol.values():
        for bar in bar_list:
            engine.add_data([bar])

    trade_size = Decimal(str(initial_capital * 0.05))
    for symbol in symbols:
        bar_type = bar_types.get(symbol)
        instrument = instruments.get(symbol)
        if not bar_type or not instrument:
            continue
        strategy = _build_nautilus_strategy(
            strategy_name, instrument.id, bar_type, trade_size
        )
        engine.add_strategy(strategy)

    engine.run()

    accounts = []
    portfolio = engine.portfolio
    for venue in engine.list_venues():
        account = portfolio.account(venue)
        if account is None:
            continue
        balances = account.balances_total()
        realized = portfolio.realized_pnls(venue) or {}
        unrealized = portfolio.unrealized_pnls(venue) or {}
        total = portfolio.total_pnls(venue) or {}
        accounts.append(
            {
                "id": str(account.id),
                "venue": str(venue),
                "balances": {str(k): str(v) for k, v in balances.items()},
                "realized_pnl": {str(k): str(v) for k, v in realized.items()},
                "unrealized_pnl": {str(k): str(v) for k, v in unrealized.items()},
                "total_pnl": {str(k): str(v) for k, v in total.items()},
            }
        )

    orders = engine.cache.orders()
    filled_orders = [o for o in orders if o.status == OrderStatus.FILLED]
    rejected_orders = [
        o for o in orders if o.status in {OrderStatus.REJECTED, OrderStatus.DENIED}
    ]

    positions = engine.cache.positions()
    open_positions = [p for p in positions if p.is_open]

    return {
        "strategy": strategy_name,
        "symbols": symbols,
        "start": start_date.strftime("%Y-%m-%d"),
        "end": end_date.strftime("%Y-%m-%d"),
        "accounts": accounts,
        "orders": {
            "total": len(orders),
            "filled": len(filled_orders),
            "rejected": len(rejected_orders),
        },
        "positions": {"total": len(positions), "open": len(open_positions)},
    }


async def _portfolio_summary(holdings: List[Dict[str, Any]]) -> Dict[str, Any]:
    from stanley.data.data_manager import DataManager
    from stanley.portfolio import PortfolioAnalyzer

    config = {"openbb": {"api_key": _load_openbb_api_key()}}
    data_manager = DataManager(config=config)
    await data_manager.initialize()

    analyzer = PortfolioAnalyzer(data_manager=data_manager)
    summary = await analyzer.analyze(holdings)
    await data_manager.close()

    return summary.to_dict() if hasattr(summary, "to_dict") else summary.__dict__


async def _portfolio_risk(
    holdings: List[Dict[str, Any]], var_level: float
) -> Dict[str, Any]:
    from stanley.data.data_manager import DataManager
    from stanley.portfolio import PortfolioAnalyzer

    config = {"openbb": {"api_key": _load_openbb_api_key()}}
    data_manager = DataManager(config=config)
    await data_manager.initialize()

    analyzer = PortfolioAnalyzer(data_manager=data_manager)
    risk = await analyzer.calculate_var(holdings, confidence=var_level)
    await data_manager.close()

    return risk.to_dict() if hasattr(risk, "to_dict") else risk.__dict__


def _format_filings(filings: List[Any]) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for filing in filings:
        item = {
            "form": getattr(filing, "form", None) or getattr(filing, "form_type", None),
            "filing_date": getattr(filing, "filing_date", None),
            "accession_no": getattr(filing, "accession_no", None),
            "description": getattr(filing, "description", None),
        }
        results.append(item)
    return results


def _sec_filings(
    ticker: str, form_type: Optional[str], limit: int
) -> List[Dict[str, Any]]:
    from stanley.accounting.edgar_adapter import EdgarAdapter

    identity = os.getenv("SEC_IDENTITY", "stanley-research@example.com")
    adapter = EdgarAdapter(identity=identity)
    filings = adapter.get_filings(ticker, form_type=form_type, limit=limit)
    return _format_filings(filings)


def _sec_filing_text(ticker: str, form_type: str) -> str:
    from stanley.accounting.edgar_adapter import EdgarAdapter

    identity = os.getenv("SEC_IDENTITY", "stanley-research@example.com")
    adapter = EdgarAdapter(identity=identity)
    filings = adapter.get_filings(ticker, form_type=form_type, limit=1)
    if not filings:
        return ""
    return adapter.get_filing_text(filings[0])


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Stanley stdio CLI")
    subparsers = parser.add_subparsers(dest="area")

    market = subparsers.add_parser("market")
    market_sub = market.add_subparsers(dest="command")

    quote = market_sub.add_parser("quote")
    quote.add_argument("symbols", nargs="+")

    chart = market_sub.add_parser("chart")
    chart.add_argument("symbol")
    chart.add_argument("--period", default="6m")

    fundamentals = market_sub.add_parser("fundamentals")
    fundamentals.add_argument("symbol")

    news = market_sub.add_parser("news")
    news.add_argument("symbol")
    news.add_argument("--limit", type=int, default=10)

    screen = market_sub.add_parser("screen")
    screen.add_argument("--criteria", default="")

    portfolio = subparsers.add_parser("portfolio")
    portfolio_sub = portfolio.add_subparsers(dest="command")

    portfolio_sub.add_parser("status")

    perf = portfolio_sub.add_parser("performance")
    perf.add_argument("--period", default="ytd")

    risk = portfolio_sub.add_parser("risk")
    risk.add_argument("--var", type=float, default=0.95)

    research = subparsers.add_parser("research")
    research_sub = research.add_subparsers(dest="command")

    sec = research_sub.add_parser("sec")
    sec.add_argument("symbol")
    sec.add_argument("--type", dest="form_type", default="10-K")
    sec.add_argument("--limit", type=int, default=5)

    analyze = research_sub.add_parser("analyze")
    analyze.add_argument("symbol")
    analyze.add_argument("--filing", dest="form_type", default="10-K")

    screen_r = research_sub.add_parser("screen")
    screen_r.add_argument("--criteria", default="")

    nautilus = subparsers.add_parser("nautilus")
    nautilus_sub = nautilus.add_subparsers(dest="command")

    backtest = nautilus_sub.add_parser("backtest")
    backtest.add_argument("strategy")
    backtest.add_argument("--symbols", default="")
    backtest.add_argument("--start", default="")

    paper = nautilus_sub.add_parser("paper-trade")
    paper.add_argument("strategy")
    paper.add_argument("--capital", type=float, default=100000)

    info = nautilus_sub.add_parser("strategy-info")
    info.add_argument("strategy")

    return parser


def main() -> int:
    args = _build_parser().parse_args()
    api_key = _load_openbb_api_key()
    provider_name = _load_openbb_provider()

    if args.area == "market":
        try:
            from stanley.data.providers.openbb_provider import (
                OpenBBAdapter,
                OpenBBProvider,
            )
        except Exception as exc:
            return _format_error(f"Stanley import failed: {exc}")

        if args.command == "quote":
            adapter = OpenBBAdapter({"provider": provider_name, "api_key": api_key})
            quotes = [adapter.get_quote(symbol) for symbol in args.symbols]
            _json_dump({"ok": True, "command": "quote", "data": quotes})
            return 0

        if args.command == "chart":
            adapter = OpenBBAdapter({"provider": provider_name, "api_key": api_key})
            bars = _chart_bars(adapter, args.symbol, args.period)
            _json_dump(
                {
                    "ok": True,
                    "command": "chart",
                    "data": {
                        "symbol": args.symbol,
                        "period": args.period,
                        "bars": bars,
                    },
                }
            )
            return 0

        if args.command == "fundamentals":
            provider = OpenBBProvider(api_key=api_key, default_provider=provider_name)
            try:
                import asyncio

                data = asyncio.run(_fundamentals(provider, args.symbol))
                _json_dump(
                    {
                        "ok": True,
                        "command": "fundamentals",
                        "data": {"symbol": args.symbol, "fundamentals": data},
                    }
                )
                return 0
            finally:
                try:
                    import asyncio

                    asyncio.run(provider.close())
                except Exception:
                    pass

        if args.command == "news":
            return _format_error("News is not available in the CLI bridge yet.", code=2)

        if args.command == "screen":
            return _format_error(
                "Screening is not available in the CLI bridge yet.", code=2
            )

        return _format_error("Unknown market command.")

    if args.area == "portfolio":
        try:
            holdings = _read_portfolio_holdings()
        except Exception as exc:
            return _format_error(str(exc))

        if args.command == "status":
            _json_dump({"ok": True, "command": "status", "data": holdings})
            return 0

        if args.command == "performance":
            import asyncio

            summary = asyncio.run(_portfolio_summary(holdings))
            _json_dump({"ok": True, "command": "performance", "data": summary})
            return 0

        if args.command == "risk":
            import asyncio

            risk = asyncio.run(_portfolio_risk(holdings, args.var))
            _json_dump({"ok": True, "command": "risk", "data": risk})
            return 0

        return _format_error("Unknown portfolio command.")

    if args.area == "research":
        if args.command == "sec":
            filings = _sec_filings(args.symbol, args.form_type, args.limit)
            _json_dump(
                {
                    "ok": True,
                    "command": "sec",
                    "data": {
                        "symbol": args.symbol,
                        "form": args.form_type,
                        "filings": filings,
                    },
                }
            )
            return 0

        if args.command == "analyze":
            text = _sec_filing_text(args.symbol, args.form_type)
            _json_dump(
                {
                    "ok": True,
                    "command": "analyze",
                    "data": {
                        "symbol": args.symbol,
                        "form": args.form_type,
                        "excerpt": text[:4000],
                    },
                }
            )
            return 0

        if args.command == "screen":
            return _format_error(
                "Screening is not available in the CLI bridge yet.", code=2
            )

        return _format_error("Unknown research command.")

    if args.area == "nautilus":
        if args.command == "strategy-info":
            strategies = {
                "momentum": {
                    "name": "momentum",
                    "description": "EMA cross long-only momentum strategy.",
                    "status": "ready",
                },
                "mean-reversion": {
                    "name": "mean-reversion",
                    "description": "Simple mean reversion using SMA threshold.",
                    "status": "ready",
                },
            }
            info = strategies.get(args.strategy)
            if not info:
                return _format_error(f"Unknown strategy: {args.strategy}")
            _json_dump({"ok": True, "command": "strategy-info", "data": info})
            return 0

        if args.command in ("backtest", "paper-trade"):
            try:
                symbols = _parse_symbols(args.symbols)
                if args.command == "paper-trade" and not args.start:
                    start_date = _utc_now() - timedelta(days=30)
                elif args.start:
                    start_date = _parse_date(args.start)
                else:
                    start_date = _utc_now() - timedelta(days=365)
                end_date = _utc_now()
                payload = _nautilus_backtest(
                    strategy_name=args.strategy,
                    symbols=symbols,
                    start_date=start_date,
                    end_date=end_date,
                    initial_capital=(
                        args.capital if hasattr(args, "capital") else 100000
                    ),
                    provider_name=provider_name,
                    api_key=api_key,
                )
                payload["mode"] = args.command
                _json_dump({"ok": True, "command": args.command, "data": payload})
                return 0
            except Exception as exc:
                return _format_error(f"NautilusTrader failed: {exc}", code=2)

        return _format_error("Unknown nautilus command.")

    return _format_error("Unknown command group.")


if __name__ == "__main__":
    raise SystemExit(main())
