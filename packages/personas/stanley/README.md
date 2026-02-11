# Stanley - Financial Research Assistant

Stanley is the financial research and market analysis persona for Zee. It provides tools for market data retrieval, portfolio analysis, SEC filings research, and algorithmic trading backtesting.

## Features

- **Market Data**: Real-time quotes, historical charts, and fundamentals via OpenBB Platform
- **Portfolio Analysis**: Position tracking, risk metrics (VaR, Sharpe, Sortino), performance attribution
- **SEC Research**: Access to 10-K, 10-Q, 8-K, 13F, and other regulatory filings
- **Algorithmic Trading**: Backtesting and paper trading via NautilusTrader

## Installation

### Quick Setup (Light)

For basic functionality without heavy dependencies:

```bash
cd packages/personas/stanley
bun run setup:light
```

### Full Setup

For all features including NautilusTrader:

```bash
cd packages/personas/stanley
bun run setup:full
```

### Development Setup

```bash
cd packages/personas/stanley
bun run setup
```

## Usage

### CLI

```bash
# Get a stock quote
.venv/bin/stanley market quote AAPL

# Get fundamental data
.venv/bin/stanley market fundamentals MSFT

# Get price chart
.venv/bin/stanley market chart GOOGL --period 3m

# Portfolio analysis
.venv/bin/stanley portfolio status
.venv/bin/stanley portfolio risk --var 0.95

# SEC filings
.venv/bin/stanley research sec TSLA --type 10-K
.venv/bin/stanley research analyze NVDA --filing 10-K

# Backtesting (requires nautilus extra)
.venv/bin/stanley nautilus backtest momentum --symbols AAPL,MSFT --start 2024-01-01
```

### Via TypeScript Bridge

Stanley integrates with Zee via the TypeScript bridge in `src/domain/stanley/tools.ts`. The tools are available under the unified Zee runtime (no persona switching).

Available tools:
- `stanley:market-data` - Market quotes, charts, fundamentals
- `stanley:portfolio` - Portfolio analysis and optimization
- `stanley:sec-filings` - SEC EDGAR filings access
- `stanley:research` - Multi-source financial research
- `stanley:nautilus` - NautilusTrader backtesting and paper trading
- `stanley:status` - Health check for Stanley backend

## Architecture

```
packages/personas/stanley/
├── pyproject.toml          # Python package definition
├── package.json            # npm scripts for setup/test
├── src/stanley/
│   ├── cli.py              # Main CLI entry point
│   ├── market/             # OpenBB market data
│   ├── portfolio/          # Portfolio tracking & analysis
│   ├── research/           # SEC filings & research
│   └── nautilus/           # NautilusTrader integration
├── scripts/
│   └── stanley_cli.py      # CLI wrapper for JSON I/O
└── tests/
```

## Dependencies

### Core (always installed)
- **OpenBB Platform** (~200MB) - Market data, fundamentals, technical analysis
- **pandas/numpy** - Data manipulation
- **httpx** - Async HTTP client
- **pydantic** - Data validation
- **click** - CLI framework

### Optional
- **NautilusTrader** (~500MB) - Backtesting, paper trading, algo execution
- **DBnomics** (~10MB) - Economic/macro data
- **sec-edgar-downloader** (~5MB) - SEC filings

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STANLEY_PORTFOLIO_FILE` | Path to portfolio JSON (default: `~/.zee/stanley/portfolio.json`) |
| `OPENBB_TOKEN` | OpenBB Platform API token (optional, for premium data) |

## Testing

```bash
bun run test
bun run test:cov  # with coverage
```

## License

MIT
