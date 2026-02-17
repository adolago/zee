---
name: stock-market-pro
description: Professional stock price tracking, fundamental analysis, and financial reporting tool. Supports global markets (US, KR, etc.), Crypto, and Forex with real-time data. (1) Real-time quotes, (2) Valuation metrics (PE, EPS, ROE), (3) Earnings calendar and consensus, (4) High-quality Candlestick & Line charts with technical indicators (MA5/20/60).
version: 1.0.0
author: Artur
tags: [finance, market-data, charts, stanley]
---

# Stock Market Pro

Professional-grade financial analysis powered by Yahoo Finance data.

## Preferred: Use Stanley Tools

For most market data needs, use the built-in Stanley tools which are already authenticated and integrated:

```
stanley:market-data { symbols: ["AAPL"], dataType: "quote" }
stanley:market-data { symbols: ["AAPL"], dataType: "historical", period: "6mo" }
stanley:market-data { symbols: ["AAPL"], dataType: "indicators" }
```

## Standalone CLI (via uv)

For chart generation and standalone use, the `yf` script can be run directly via `uv` (Python 3.11+, no API key required):

### Real-time Quotes
```bash
uv run --script scripts/yf price AAPL
```

### Professional Charts (PNG output)
```bash
# Candlestick with volume and moving averages
uv run --script scripts/yf pro AAPL 6mo

# Line chart
uv run --script scripts/yf pro AAPL 1y line
```

Periods: `1mo`, `3mo`, `6mo`, `1y`, `5y`, `max`

### Fundamental Analysis
```bash
uv run --script scripts/yf fundamentals AAPL
```

### Earnings & Estimates
```bash
uv run --script scripts/yf earnings AAPL
```

### Historical Trends
```bash
uv run --script scripts/yf history AAPL
```

## Ticker Examples
- **US Stocks**: `AAPL`, `NVDA`, `TSLA`
- **Korean Stocks**: `005930.KS` (Samsung), `000660.KS` (SK Hynix)
- **Crypto**: `BTC-USD`, `ETH-KRW`

## Notes

- The `scripts/yf` script is managed by Zee and uses `uv` inline script metadata for automatic dependency resolution (`yfinance`, `mplfinance`, `rich`).
- If the script is missing, the Zee-managed version at `@zee/skills/stock-market-pro/` may need a sync update, or use Stanley tools directly.
