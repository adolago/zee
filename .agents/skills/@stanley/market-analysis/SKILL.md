---
name: market-analysis
description: Analyze market conditions, sector rotation, and macro trends
version: 1.0.0
author: Artur
tags: [finance, market, analysis, stanley]
triggers:
  - market analysis
  - sector rotation
  - market overview
  - macro outlook
  - economic data
---

# Market Analysis

Analyze overall market conditions and identify sector opportunities.

## Market Overview Queries

### Major Indices
```
# Index performance
obb.index.price.historical(symbol="^SPX,^IXIC,^DJI", provider="yfinance")

# VIX (fear gauge)
obb.index.price.historical(symbol="^VIX", provider="cboe")
```

### Sector Performance
```
# Sector ETF performance comparison
sectors = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLC", "XLY", "XLP", "XLU", "XLRE", "XLB"]
obb.equity.price.performance(symbol=",".join(sectors), provider="fmp")
```

### Economic Indicators
```
# Key FRED series
obb.economy.fred_series(symbol="GDP")           # GDP
obb.economy.fred_series(symbol="UNRATE")        # Unemployment
obb.economy.fred_series(symbol="CPIAUCSL")      # CPI
obb.economy.fred_series(symbol="FEDFUNDS")      # Fed Funds Rate
obb.economy.fred_series(symbol="T10Y2Y")        # Yield curve spread
```

## Sector Rotation Analysis

Using Stanley's SectorRotationAnalyzer:
```
from stanley.analytics import SectorRotationAnalyzer

analyzer = SectorRotationAnalyzer(stanley)
rotation = analyzer.detect_rotation(lookback_days=90)
momentum = analyzer.calculate_sector_momentum()
regime = analyzer.detect_market_regime()
```

## Money Flow Analysis

```
from stanley.analytics import MoneyFlowAnalyzer

mf = MoneyFlowAnalyzer(stanley)
sector_flows = mf.get_sector_money_flow(["XLK", "XLF", "XLE"])
institutional_flow = mf.get_institutional_flow("SPY")
```

## Output Templates

### Daily Market Brief
- Index moves and VIX
- Sector leadership/laggards
- Key economic data releases
- Notable earnings/events

### Weekly Market Review
- Sector rotation trends
- Money flow analysis
- Risk-on vs risk-off positioning
- Forward calendar

## Memory Integration

Store market context:
```typescript
await memory.store({
  namespace: "stanley/market",
  key: `daily/${date}`,
  value: {
    indices: { spx, ndx, vix },
    sectorLeaders: [...],
    sectorLaggards: [...],
    keyEvents: [...]
  },
  ttl: 86400 * 7
});
```
