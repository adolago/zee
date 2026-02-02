---
name: earnings-intelligence
description: Analyze earnings reports, calls, and estimate revisions
version: 1.0.0
author: Artur
tags: [finance, earnings, analysis, stanley]
triggers:
  - earnings analysis
  - earnings call
  - earnings surprise
  - estimate revisions
  - quarterly results
---

# Earnings Intelligence

Comprehensive earnings analysis and call intelligence.

## Pre-Earnings Research

### Upcoming Earnings
```
# Get earnings calendar
obb.equity.calendar.earnings(start_date="2024-01-15", end_date="2024-01-31")

# Earnings estimates
obb.equity.estimates.consensus(symbol="AAPL", provider="fmp")
```

### Historical Performance
```
# Past earnings surprises
obb.equity.fundamental.historical_eps(symbol="AAPL", provider="fmp")
```

## Earnings Call Analysis

### Transcript Processing
Using meeting intelligence integration:
```
# When an earnings call transcript is available
from stanley.notes import NoteManager

notes = NoteManager()
event = notes.create_event(
    symbol="AAPL",
    company_name="Apple Inc.",
    event_type="earnings_call",
    event_date="2024-01-25"
)
```

### Key Metrics to Track
1. Revenue vs estimates
2. EPS vs estimates
3. Guidance changes
4. Margin trends
5. Key segment performance
6. Management tone/confidence

## Post-Earnings Analysis

### Estimate Revisions
```
from stanley.research import analyze_estimate_revisions

revisions = analyze_estimate_revisions(
    symbol="AAPL",
    days_after_earnings=30
)
```

### Price Reaction
```
# Implied vs actual move
obb.equity.price.historical(symbol="AAPL", start_date=earnings_date)
```

## Memory Patterns

Store earnings insights:
```typescript
await memory.store({
  namespace: "stanley/earnings",
  key: `${symbol}/${quarter}`,
  value: {
    date: earningsDate,
    epsActual: 1.52,
    epsEstimate: 1.48,
    surprise: 0.027,
    guidance: "raised",
    keyTakeaways: ["..."],
    analystReactions: ["..."]
  }
});
```

## Automated Workflows

### Pre-Earnings Alert
Triggered by earnings calendar:
1. Get consensus estimates
2. Review prior quarter
3. Set up event note
4. Identify key metrics to watch

### Post-Earnings Summary
Day after earnings:
1. Pull actual results
2. Calculate surprise
3. Get analyst revisions
4. Update thesis if needed
