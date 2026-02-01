---
name: investment-thesis
description: Create and track investment theses with conviction levels
version: 1.0.0
author: Artur
tags: [finance, thesis, investing, stanley]
triggers:
  - investment thesis
  - stock thesis
  - create thesis
  - update thesis
  - thesis tracking
---

# Investment Thesis Management

Create, track, and manage investment theses using Stanley's note system.

## Creating a Thesis

### Research Phase
1. Gather fundamental data (via OpenBB)
2. Analyze financial statements (via Stanley/edgartools)
3. Assess competitive position
4. Build valuation model
5. Identify risks and catalysts

### Thesis Template

Using Stanley's NoteManager:
```
from stanley.notes import NoteManager, ConvictionLevel

notes = NoteManager()

thesis = notes.create_thesis(
    symbol="AAPL",
    company_name="Apple Inc.",
    sector="Technology",
    conviction="high"  # low, medium, high, very_high
)
```

## Thesis Structure

```markdown
## Investment Thesis: AAPL

### Bull Case
- Services revenue growing 15%+ annually
- Installed base creates recurring revenue
- Strong cash generation, shareholder returns

### Bear Case
- Flagship handset dependence (50%+ revenue)
- China regulatory/geopolitical risk
- Hardware margin pressure

### Valuation
- DCF Target: $185
- Comparable Multiple: 28x forward PE
- Current Price: $172

### Conviction Level: HIGH
- Time Horizon: 12-18 months
- Position Size: 5% of portfolio

### Catalysts
- Q1 2024 earnings (Jan 25)
- WWDC 2024 (Jun)
- Flagship handset launch (Sep)

### Risk Monitoring
- Services growth < 10%
- China revenue decline > 15%
- Gross margin < 42%
```

## Tracking Theses

```
# Get active theses
active = notes.get_theses(status="active")

# Get by symbol
aapl_thesis = notes.get_theses(symbol="AAPL")

# Search theses
results = notes.search("Services growth Technology")
```

## Memory Integration

```typescript
// Store thesis in memory for cross-session access
await memory.store({
  namespace: "stanley/theses",
  key: symbol,
  value: {
    symbol,
    conviction,
    targetPrice,
    bullCase: [...],
    bearCase: [...],
    catalysts: [...],
    riskTriggers: [...],
    lastReviewed: new Date()
  }
});

// Retrieve for quick access
const thesis = await memory.retrieve("stanley/theses", symbol);
```

## Thesis Review Workflow

Weekly review checklist:
1. Price action vs thesis
2. Any material news/events?
3. Estimate revisions direction
4. Technical levels
5. Thesis still valid?

## Conviction Changes

Track conviction history:
```typescript
await memory.store({
  namespace: "stanley/theses",
  key: symbol,
  value: {
    // ... existing fields
    history: [
      { date: "2024-01-01", conviction: "medium", note: "Initial thesis" },
      { date: "2024-01-20", conviction: "high", note: "Strong Q4 results" }
    ]
  }
});
```
