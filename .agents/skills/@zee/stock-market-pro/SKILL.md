---
name: stock-market-pro
description: Professional stock price tracking, fundamental analysis, and financial reporting tool. Supports global markets (US, KR, etc.), Crypto, and Forex with real-time data via Yahoo Finance. Real-time quotes, valuation metrics (PE, EPS, ROE), earnings calendar, and candlestick/line charts with technical indicators.
version: 1.0.0
author: kys42
tags: [stocks, finance, charts, analysis]
source: clawhub
metadata: {"clawhub":{"id":"kys42/stock-market-pro"}}
---

# Stock Market Pro

A professional-grade financial analysis tool powered by Yahoo Finance data.

## Core Features

### 1. Real-time Quotes (`price`)
Get instant price updates and day ranges.
```bash
uv run --script scripts/yf price [TICKER]
```

### 2. Professional Charts (`pro`)
Generate high-resolution PNG charts with Volume and Moving Averages.
- **Candlestick**: `uv run --script scripts/yf pro [TICKER] [PERIOD]`
- **Line Chart**: `uv run --script scripts/yf pro [TICKER] [PERIOD] line`
- **Periods**: `1mo`, `3mo`, `6mo`, `1y`, `5y`, `max`, etc.

### 3. Fundamental Analysis (`fundamentals`)
Deep dive into valuation: Market Cap, PE, EPS, ROE, and Profit Margins.
```bash
uv run --script scripts/yf fundamentals [TICKER]
```

### 4. Earnings & Estimates (`earnings`)
Check upcoming earnings dates and market consensus (Expected Revenue/EPS).

### 5. Historical Trends (`history`)
View recent 10-day trends with terminal-friendly ASCII charts.

## Ticker Examples
- **US Stocks**: `AAPL`, `NVDA`, `TSLA`
- **Korean Stocks**: `005930.KS` (Samsung), `000660.KS` (SK Hynix)
- **Crypto**: `BTC-USD`, `ETH-KRW`

## Technical Notes
- **Engine**: Python 3.11+, `yfinance`, `mplfinance`, `rich`
- **Key Benefit**: No API key required. Automatically handles dependencies via `uv`.
