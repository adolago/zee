---
name: autonomous-research
description: Autonomous multi-step financial research with iterative validation and scratchpad logging. Covers fundamental analysis, market/sector analysis, and earnings intelligence.
version: 2.0.0
author: Artur
tags: [finance, research, autonomous, stanley, analysis, earnings, market, sector]
triggers:
  - deep research
  - autonomous research
  - research loop
  - comprehensive analysis
  - should I invest
  - compare valuation
  - full analysis
  - research report
  - stock research
  - company analysis
  - investment thesis
  - fundamental analysis
  - valuation
  - market analysis
  - sector rotation
  - market overview
  - macro outlook
  - economic data
  - earnings analysis
  - earnings call
  - earnings surprise
  - estimate revisions
  - quarterly results
---

# Autonomous Research Loop

Multi-step iterative financial research with scratchpad logging and memory persistence.

## Overview

This skill guides you through autonomous financial research. Follow the phases strictly.
Do NOT skip phases. Track all tool calls to prevent duplicates. Maximum 10 data-gathering
tool calls per session (scratchpad calls do not count toward this limit).

## Tool-to-Question Mapping

| Question Type | Primary Tool | Parameters |
|---|---|---|
| Current price/valuation | `stanley:market-data` | `dataType: "quote"` |
| Historical performance | `stanley:market-data` | `dataType: "chart"` |
| Fundamental metrics | `stanley:market-data` | `dataType: "fundamentals"` |
| Analyst consensus | `stanley:estimates` | `estimateType: "consensus"` |
| EPS projections | `stanley:estimates` | `estimateType: "forward_eps"` |
| Price targets | `stanley:estimates` | `estimateType: "price_target"` |
| Estimate revisions | `stanley:estimates` | `estimateType: "revisions"` |
| Insider activity | `stanley:insider-trades` | |
| Revenue segments | `stanley:segments` | `segmentType: "business"` |
| Geographic exposure | `stanley:segments` | `segmentType: "geography"` |
| SEC filings | `stanley:sec-filings` | `formType: "10-K"` etc. |
| News/sentiment | `stanley:research` | `sources: ["news"]` |
| Stock screening | `stanley:research` | `sources: ["analyst"]` |
| Portfolio fit | `stanley:portfolio` | `action: "analyze"` |
| Strategy backtest | `stanley:nautilus` | `action: "backtest"` |

## Phase 1: Research Plan

Given the user's question, decompose it into 5-15 concrete sub-questions. Each maps to
specific Stanley tools from the table above.

Format the plan as a numbered checklist:
```
1. [ ] Get current AAPL quote and fundamentals
2. [ ] Review analyst consensus and price targets
3. [ ] Check insider trading sentiment
4. [ ] Analyze revenue segments for growth drivers
5. [ ] Review most recent 10-K filing
...
```

### Initialize Scratchpad
```
stanley:scratchpad {
  action: "init",
  question: "<user's research question>",
  plan: ["step 1 description", "step 2 description", ...]
}
```
Save the returned `sessionId` for all subsequent scratchpad calls.

### Check Memory First
Before executing the plan, check for previous research:
```
memory.search({ domain: "research", topic: "<ticker>", namespace: "stanley" })
```
If prior research exists, incorporate known facts and skip redundant data gathering.

## Phase 2: Iterative Execution

For each step in the plan (up to 10 data-gathering tool calls total):

### Step Protocol
1. **Check duplicate** before every data call:
   ```
   stanley:scratchpad {
     action: "check_duplicate",
     sessionId: "<id>",
     toolId: "<tool to call>",
     args: { <exact args> }
   }
   ```
   If `duplicate: true`, skip the call and use the `previousResult`.

2. **Execute the tool** if not a duplicate.

3. **Log the result**:
   ```
   stanley:scratchpad {
     action: "log",
     sessionId: "<id>",
     iteration: <N>,
     phase: "execution",
     toolId: "<tool called>",
     args: { <args used> },
     resultOk: true/false,
     resultSummary: "<brief summary of key findings>",
     notes: "<your assessment of data quality/relevance>"
   }
   ```

4. **Assess sufficiency**: Is the result useful for answering the question?
   - If insufficient data returned, refine the query and retry (max 2 retries per step)
   - If the tool fails, note the failure and move on

## Phase 3: Validate Findings

After executing all planned steps:

1. **Review collected data**:
   ```
   stanley:scratchpad { action: "read", sessionId: "<id>" }
   ```

2. **Identify gaps** -- Check for missing coverage:
   - Fundamental data gathered?
   - Valuation metrics available?
   - Recent filings reviewed?
   - Risk factors assessed?
   - Competitive position understood?
   - Insider/analyst sentiment checked?

3. **Fill gaps** if iteration budget remains:
   - Add new steps for missing data
   - Return to Phase 2 for those steps only

4. **Move to synthesis** when:
   - All critical data gathered, OR
   - Iteration budget exhausted (10 tool calls), OR
   - Remaining gaps are non-critical

## Phase 4: Synthesize Report

Produce a structured research report:

```
## Research Report: [TOPIC]

### Executive Summary
[2-3 sentence overview of findings and conclusion]

### Key Findings

#### Fundamentals
- [key metrics, valuation ratios, growth rates]

#### Analyst Sentiment
- [consensus rating, price targets, recent revisions]

#### Insider Activity
- [net buying/selling, notable transactions]

#### Growth Drivers
- [segment performance, geographic trends]

#### Risk Factors
- [identified risks from filings, market data]

### Bull Case
1. [reason with supporting data]
2. [reason with supporting data]
3. [reason with supporting data]

### Bear Case
1. [risk with supporting data]
2. [risk with supporting data]
3. [risk with supporting data]

### Confidence Assessment
- Data Quality: [High/Medium/Low] -- based on data freshness and completeness
- Conviction: [High/Medium/Low] -- based on evidence strength
- Key Uncertainty: [primary unknown that could change the conclusion]

### Data Sources Used
- [list of tools called with key parameters]
```

## Phase 5: Persist and Close

### Store Key Findings
```
memory.store({
  category: "note",
  domain: "research",
  topic: "<ticker or topic>",
  subtopic: "analysis",
  kind: "agent",
  priority: "high",
  memoryId: "research-<topic>",
  content: <research summary>,
  summary: "<one-line summary of conclusion>"
})
```

### Close Scratchpad
```
stanley:scratchpad {
  action: "close",
  sessionId: "<id>",
  summary: "<final one-paragraph summary>"
}
```

## Configuration Defaults

- Maximum data-gathering tool calls: 10
- Maximum retries per step: 2
- Scratchpad location: ~/.local/state/zee/stanley/scratchpad/

## Example: "Should I invest in AAPL?"

**Plan:**
1. Get AAPL quote and fundamentals
2. Get analyst consensus and price targets
3. Check insider trading sentiment
4. Analyze revenue by business segment
5. Review estimate revisions for momentum
6. Get 6-month price chart for trend
7. Review recent 10-K filing highlights

**Execution:** 7 tool calls + 7 scratchpad logs + 7 duplicate checks = 21 total calls,
but only 7 count toward the iteration budget.

**Synthesis:** Structured report with fundamentals, sentiment, growth analysis, bull/bear
cases, and confidence assessment.

**Persist:** Store findings in memory for future reference. Close scratchpad.

---

## Research Modes

The autonomous research loop above is the default mode. For focused analysis, use these specialized modes which follow the same phased approach but emphasize specific data gathering.

### Fundamental Analysis Mode

Focus: company-level financial deep dive.

**Key data sources:**
- `stanley:market-data` with `dataType: "fundamentals"` -- PE, PB, ROE, margins, growth
- `stanley:market-data` with `dataType: "quote"` -- current price, market cap
- `stanley:sec-filings` -- 10-K, 10-Q for detailed financials
- `stanley:estimates` with `estimateType: "consensus"` -- analyst consensus
- `stanley:segments` with `segmentType: "business"` -- revenue breakdown

**Report sections:** Executive Summary, Business Overview, Financial Analysis (revenue trends, margins, ROE/ROIC), Valuation (DCF, comparables, historical multiples), Risks, Catalysts.

### Market / Sector Analysis Mode

Focus: macro conditions, sector rotation, cross-asset trends.

**Key data sources:**
- `stanley:market-data` with `dataType: "quote"` for index ETFs (SPY, QQQ, IWM, sector ETFs)
- `stanley:market-data` with `dataType: "chart"` for trend analysis
- `stanley:research` with `sources: ["news"]` for macro news
- Web search for economic data (FRED, BLS releases)

**Report sections:** Index Performance, Sector Leadership/Laggards, Money Flow, Risk-On vs Risk-Off Positioning, Forward Calendar.

### Earnings Intelligence Mode

Focus: pre/post-earnings analysis and estimate tracking.

**Key data sources:**
- `stanley:estimates` with `estimateType: "consensus"` -- EPS/revenue expectations
- `stanley:estimates` with `estimateType: "forward_eps"` -- forward projections
- `stanley:estimates` with `estimateType: "revisions"` -- estimate momentum
- `stanley:market-data` with `dataType: "fundamentals"` -- historical earnings
- `stanley:insider-trades` -- insider activity around earnings

**Pre-earnings checklist:** consensus estimates, prior quarter results, estimate revision trend, insider activity, implied move from options.

**Post-earnings checklist:** actual vs estimates (surprise), guidance changes, analyst revision direction, price reaction vs implied move.
