---
name: financial-research
description: Conduct fundamental investment research using OpenBB and Stanley backend
version: 1.0.0
author: Artur
tags: [finance, research, analysis, stanley]
triggers:
  - stock research
  - company analysis
  - investment thesis
  - fundamental analysis
  - valuation
---

# Financial Research

Conduct rigorous fundamental investment research on public companies using OpenBB data and Stanley analysis tools.

## Available Data Sources

### Via OpenBB MCP
- **Equity Data**: Historical prices, fundamentals, ownership, shorts
- **News & Sentiment**: Company news, market news, analyst coverage
- **SEC Filings**: 10-K, 10-Q, 8-K filings via SEC provider

### Via Stanley Backend
- **Research**: ResearchAnalyzer, DCF models, peer comparison
- **Analytics**: Money flow, institutional positioning, options flow
- **Accounting**: Financial statements, earnings quality, red flags

## Research Workflow

### 1. Company Overview
```
# Quick overview using OpenBB
obb.equity.fundamental.overview(symbol="AAPL", provider="fmp")
obb.equity.profile(symbol="AAPL")
```

### 2. Financial Analysis
```
# Income statement trend
obb.equity.fundamental.income(symbol="AAPL", period="annual", limit=5)

# Balance sheet strength
obb.equity.fundamental.balance(symbol="AAPL", period="annual")

# Cash flow analysis
obb.equity.fundamental.cash(symbol="AAPL", period="annual")

# Key ratios
obb.equity.fundamental.ratios(symbol="AAPL")
```

### 3. Ownership & Positioning
```
# Institutional holders (13F)
obb.equity.ownership.institutional(symbol="AAPL", provider="fmp")

# Insider trading
obb.equity.ownership.insider_trading(symbol="AAPL")

# Short interest
obb.equity.shorts.short_volume(symbol="AAPL")
```

### 4. Valuation Analysis
```
# Use Stanley's valuation module
from stanley.research import calculate_dcf, compare_to_peers

dcf_result = calculate_dcf(
    symbol="AAPL",
    growth_rate=0.08,
    discount_rate=0.10,
    terminal_growth=0.025
)

peers = compare_to_peers("AAPL", ["MSFT", "GOOGL", "AMZN"])
```

## Output Format

Research reports should include:
1. **Executive Summary**: Key thesis and recommendation
2. **Business Overview**: What the company does, moat analysis
3. **Financial Analysis**: Revenue trends, margins, ROE/ROIC
4. **Valuation**: DCF, comparables, historical multiples
5. **Risks**: Key risks and bear case scenarios
6. **Catalysts**: Upcoming events and inflection points

## Memory Integration

Store research findings:
```typescript
await memory.store({
  namespace: "stanley/research",
  key: `thesis/${symbol}`,
  value: {
    symbol,
    thesis: "...",
    conviction: "high",
    targetPrice: 185,
    lastUpdated: new Date()
  }
});
```
