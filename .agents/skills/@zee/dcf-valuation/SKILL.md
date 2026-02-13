---
name: dcf-valuation
description: Discounted Cash Flow valuation model with sensitivity analysis
version: 1.0.0
author: Artur
tags: [finance, valuation, dcf, stanley]
triggers:
  - dcf valuation
  - dcf analysis
  - intrinsic value
  - fair value
  - discounted cash flow
  - what is it worth
---

# DCF Valuation Model

Structured 8-step Discounted Cash Flow analysis using Stanley tools.

## Prerequisites

Before starting, search memory for prior valuations:
```
memory.search({ domain: "valuations", topic: <symbol> })
```

If a prior DCF exists, load it and compare assumptions to current data.

## Step 1: Gather Financial Data

Collect baseline financials needed for DCF inputs.

### Required Tool Calls
```
stanley:market-data { symbol: "<TICKER>", dataType: "fundamentals" }
stanley:segments { symbol: "<TICKER>", segmentType: "business" }
stanley:estimates { symbol: "<TICKER>", estimateType: "consensus" }
```

### Key Metrics to Extract
- Revenue (TTM and last 3 years)
- Operating Income / EBIT
- Depreciation and Amortization
- Capital Expenditures
- Change in Working Capital
- Shares Outstanding
- Current Share Price
- Net Debt (Total Debt - Cash)
- Tax Rate (effective)

## Step 2: Calculate Free Cash Flow (Historical)

```
FCF = Operating Income * (1 - Tax Rate) + D&A - CapEx - Change in Working Capital

Alternative:
FCF = Cash from Operations - Capital Expenditures
```

Compute for last 3-5 years. Calculate:
- FCF margin (FCF / Revenue)
- FCF growth rate (CAGR over available period)
- FCF per share

## Step 3: Estimate Growth Rate

Use multiple sources to triangulate:

1. Historical FCF growth (3-5 year CAGR)
2. Analyst consensus: `stanley:estimates { estimateType: "forward_eps" }`
3. Segment growth: `stanley:segments { segmentType: "business" }`
4. Industry benchmarks

### Growth Phases
- Phase 1 (Years 1-5): High growth (analyst consensus or historical)
- Phase 2 (Years 6-10): Linear fade toward terminal rate
- Terminal: Long-term GDP growth (~2.5%)

Justify the chosen rate with evidence from gathered data.

## Step 4: Estimate Discount Rate (WACC)

```
WACC = (E/V) * Re + (D/V) * Rd * (1 - T)

Re = Risk-free rate + Beta * Equity Risk Premium
Rd = Cost of debt (interest expense / total debt)
T  = Effective tax rate
E  = Market cap, D = Total debt, V = E + D
```

### Typical Inputs
- Risk-free rate: 10-year Treasury (~4.0-4.5%)
- Equity risk premium: 5.0-6.0%
- Beta: from fundamentals data

If WACC cannot be calculated precisely, use sector defaults:
- Large-cap stable: 8-9%
- Mid-cap growth: 10-11%
- Small-cap / high-risk: 12%+

## Step 5: Project Future Cash Flows

Build a 10-year projection:

| Year | Revenue | Growth % | FCF Margin | FCF | Discount Factor | PV of FCF |
|------|---------|----------|------------|-----|-----------------|-----------|
| 1    |         |          |            |     | 1/(1+WACC)^1    |           |
| ...  |         |          |            |     |                 |           |
| 10   |         |          |            |     | 1/(1+WACC)^10   |           |

Apply Phase 1 growth for years 1-5, Phase 2 (fading) for years 6-10.

## Step 6: Calculate Terminal Value

Gordon Growth Model:
```
Terminal Value = FCF_year10 * (1 + terminal_growth) / (WACC - terminal_growth)
PV of Terminal Value = Terminal Value / (1 + WACC)^10
```

Terminal growth: 2.0-3.0% (at or below long-term nominal GDP growth).

### Sanity Check
Terminal value as % of total enterprise value:
- Typical: 60-80% for growth companies
- If >85%, the model is too dependent on terminal assumptions -- flag this

## Step 7: Calculate Fair Value Per Share

```
Enterprise Value = Sum(PV of FCFs) + PV of Terminal Value
Equity Value = Enterprise Value - Net Debt + Cash
Fair Value Per Share = Equity Value / Shares Outstanding
```

### Margin of Safety
- >30% upside: Strong Buy signal
- 15-30% upside: Buy signal
- 0-15% upside: Fairly valued
- <0% (negative): Overvalued

## Step 8: Sensitivity Analysis

Build matrices varying the two most impactful assumptions:

### WACC vs Terminal Growth
|              | TG 2.0% | TG 2.5% | TG 3.0% |
|--------------|---------|---------|---------|
| WACC 8%      | $___    | $___    | $___    |
| WACC 9%      | $___    | $___    | $___    |
| WACC 10%     | $___    | $___    | $___    |
| WACC 11%     | $___    | $___    | $___    |

### Growth Rate vs WACC
|              | Growth 5% | Growth 8% | Growth 10% | Growth 12% |
|--------------|-----------|-----------|------------|------------|
| WACC 8%      | $___      | $___      | $___       | $___       |
| WACC 10%     | $___      | $___      | $___       | $___       |
| WACC 12%     | $___      | $___      | $___       | $___       |

## Validation Checklist

Before presenting results, verify:
- [ ] FCF margin within industry norms
- [ ] Growth rate supported by analyst estimates and segment data
- [ ] WACC reasonable for company risk profile
- [ ] Terminal value < 80% of total EV
- [ ] Implied P/E at terminal year is reasonable
- [ ] Compare to analyst price targets: `stanley:estimates { estimateType: "price_target" }`
- [ ] Cross-reference insider sentiment: `stanley:insider-trades { symbol: "<TICKER>" }`

## Output Format

Present the final valuation as:

```
## DCF Valuation: [SYMBOL]

Fair Value: $XXX.XX per share
Current Price: $XXX.XX
Upside/Downside: +XX.X% / -XX.X%

### Key Assumptions
- Revenue Growth (Phase 1): X.X%
- Revenue Growth (Phase 2): X.X% fading to X.X%
- FCF Margin: XX.X%
- WACC: XX.X%
- Terminal Growth: X.X%

### Valuation Summary
| Component            | Value        |
|----------------------|-------------|
| PV of Cash Flows     | $XX,XXX M   |
| PV of Terminal Value  | $XX,XXX M   |
| Enterprise Value      | $XX,XXX M   |
| Less: Net Debt        | ($X,XXX M)  |
| Equity Value          | $XX,XXX M   |
| Shares Outstanding    | X,XXX M     |
| Fair Value/Share      | $XXX.XX     |

### Sensitivity Matrix
[Tables from Step 8]

### Confidence Assessment
- Data Quality: [High/Medium/Low]
- Model Sensitivity: [High/Medium/Low]
- Recommendation: [Strong Buy / Buy / Hold / Sell]
```

## Memory Integration

Store completed valuations:
```
memory.store({
  category: "note",
  domain: "valuations",
  topic: <symbol>,
  subtopic: "dcf",
  kind: "agent",
  priority: "high",
  memoryId: "dcf-<symbol>",  // Enables version control
  content: <valuation JSON>,
  summary: "DCF valuation for <SYMBOL>: Fair value $X vs current $Y (Z% upside)"
})
```

## Revision Workflow

When revisiting a DCF:
1. Load previous valuation from memory
2. Refresh financial data with current tools
3. Compare assumptions vs actuals
4. Update model with new data
5. Store as new version (same memoryId triggers versioning)
