---
name: "News Digest"
description: "Generate daily news digests for portfolio holdings and watchlist. Aggregates financial news from multiple sources, summarizes key developments, and highlights market-moving events. Use when you need a comprehensive market briefing or want to stay informed on specific tickers."
version: 1.0.0
author: Artur
tags: [finance, news, portfolio, stanley]
---

# News Digest

## What This Skill Does

Generates comprehensive news digests for your portfolio holdings and watchlist by:

1. **Searching** via agent-core's Exa MCP (no API key needed)
2. **Filtering** for financially relevant content (earnings, filings, analyst ratings, M&A)
3. **Summarizing** using agent-core's LLM providers (already authenticated)
4. **Categorizing** news by sentiment and impact level
5. **Outputting** structured digests in multiple formats (JSON, Markdown, Email)

**Use Cases**:
- Morning market briefing before market open
- End-of-day summary of portfolio-relevant news
- Earnings season monitoring
- SEC filing alerts
- Macro event tracking

## Architecture

```
Stanley -> Tiara (claude-flow) -> Agent-Core
              │                      │
              │                      ├── WebSearch (Exa MCP)
              │                      ├── WebFetch (content extraction)
              │                      └── 15+ LLM providers (auth.json)
              │
              └── MCP Tools (100+ orchestration tools)
```

**No separate API keys required** - leverages agent-core infrastructure:
- Web search via `mcp.exa.ai` (same as agent-core's websearch.ts)
- LLM summarization via `~/.opencode/auth.json` providers
- Python 3.10+ with `httpx`

## Quick Start

```bash
# Single ticker digest
python {baseDir}/scripts/news_digest.py --tickers AAPL

# Portfolio digest (multiple tickers)
python {baseDir}/scripts/news_digest.py --tickers AAPL,NVDA,MSFT,GOOGL

# With summarization
python {baseDir}/scripts/news_digest.py --tickers AAPL --summarize

# Custom time range (last 24h, 7d, 30d)
python {baseDir}/scripts/news_digest.py --tickers AAPL --range 7d

# Output formats
python {baseDir}/scripts/news_digest.py --tickers AAPL --format json
python {baseDir}/scripts/news_digest.py --tickers AAPL --format markdown
python {baseDir}/scripts/news_digest.py --tickers AAPL --format email
```

---

## Search Categories

The digest searches for news in these categories per ticker:

| Category | Search Query Pattern |
|----------|---------------------|
| **General** | `{ticker} stock news` |
| **Earnings** | `{ticker} earnings report results` |
| **SEC Filings** | `{ticker} SEC filing 10-K 10-Q 8-K` |
| **Analyst** | `{ticker} analyst rating upgrade downgrade` |
| **Insider** | `{ticker} insider trading buy sell` |
| **M&A** | `{ticker} merger acquisition deal` |
| **Macro** | `{ticker} Fed interest rates inflation` |

---

## Output Formats

### JSON (for programmatic use)

```json
{
  "generated_at": "2026-01-09T08:00:00Z",
  "tickers": ["AAPL"],
  "range": "24h",
  "articles": [
    {
      "ticker": "AAPL",
      "category": "earnings",
      "title": "Apple Reports Record Q1 Revenue",
      "url": "https://...",
      "source": "Reuters",
      "published": "2026-01-09T06:30:00Z",
      "summary": "Apple reported Q1 revenue of $130B...",
      "sentiment": "positive",
      "impact": "high"
    }
  ],
  "summary": {
    "total_articles": 15,
    "by_sentiment": {"positive": 8, "neutral": 5, "negative": 2},
    "key_themes": ["earnings beat", "services growth", "China recovery"]
  }
}
```

### Markdown (for reading/sharing)

```markdown
# News Digest - 2026-01-09

## AAPL - Apple Inc.

### High Impact
- **[Apple Reports Record Q1 Revenue](https://...)** (Reuters)
  Revenue beat expectations at $130B, driven by services growth...

### Earnings & Financials
- [Apple CFO Comments on Margin Outlook](https://...)
- [Analysts Raise Price Targets Post-Earnings](https://...)

### Analyst Activity
- [Morgan Stanley Upgrades to Overweight](https://...)
```

### Email (for notifications)

Generates HTML email-ready content with:
- Executive summary at top
- Color-coded sentiment indicators
- Clickable article links
- Unsubscribe footer

---

## Integration with Stanley

### Use with Portfolio Analyzer

```python
from stanley.portfolio import PortfolioAnalyzer
from stanley.skills.news_digest import generate_digest

# Get holdings from portfolio
portfolio = PortfolioAnalyzer()
holdings = portfolio.get_holdings()
tickers = [h['symbol'] for h in holdings]

# Generate digest for all holdings
digest = await generate_digest(
    tickers=tickers,
    range='24h',
    summarize=True
)
```

### Use with Research Module

```python
from stanley.research import ResearchAnalyzer
from stanley.skills.news_digest import search_news

# Enrich research report with recent news
research = ResearchAnalyzer()
report = await research.get_report('AAPL')

news = await search_news('AAPL', categories=['earnings', 'analyst'])
report['recent_news'] = news
```

### API Endpoint

```python
# Add to stanley/api/routers/news.py
@router.get("/news/digest/{symbols}")
async def get_news_digest(
    symbols: str,
    range: str = "24h",
    summarize: bool = False,
    format: str = "json"
):
    tickers = symbols.upper().split(",")
    return await generate_digest(tickers, range, summarize, format)
```

---

## Configuration

### Agent-Core Auth (automatic)

Authentication is handled by agent-core's centralized auth system:

```bash
# View current auth status
cat ~/.opencode/auth.json

# Auth is managed via opencode CLI
opencode auth login anthropic
opencode auth login openai
```

### Config File (optional)

Create `~/.stanley/news_digest.toml`:

```toml
[search]
max_results_per_category = 5
excluded_domains = ["seekingalpha.com"]  # Paywall sites
preferred_sources = ["reuters.com", "bloomberg.com", "wsj.com"]

[summarization]
enabled = true
max_tokens = 150

[categories]
# Enable/disable specific categories
earnings = true
sec_filings = true
analyst = true
insider = true
ma = true
macro = false  # Disable macro news
```

---

## Scheduling

### Cron Job (Daily Digest)

```bash
# Morning digest at 6:30 AM ET (before market open)
30 6 * * 1-5 cd ~/stanley && python -m stanley.skills.news_digest \
  --portfolio --summarize --format email --send

# Evening digest at 5:00 PM ET (after market close)
0 17 * * 1-5 cd ~/stanley && python -m stanley.skills.news_digest \
  --portfolio --summarize --format markdown > ~/digests/$(date +%Y-%m-%d).md
```

### With Zee Integration

```bash
# Zee can trigger digest and send via messaging
zee agent --message "Generate news digest for my portfolio and send to Telegram"
```

---

## Sentiment Analysis

Articles are classified by sentiment using keyword analysis and optional LLM scoring:

| Sentiment | Indicators |
|-----------|------------|
| **Positive** | beat, exceeds, upgrade, growth, record, surge, rally |
| **Negative** | miss, downgrade, decline, layoffs, lawsuit, warning |
| **Neutral** | announces, reports, files, updates, maintains |

Impact levels (high/medium/low) are determined by:
- Source authority (Bloomberg/Reuters = higher)
- Article recency
- Keyword intensity
- Ticker mention prominence

---

## Troubleshooting

### No results returned
- Check `BRAVE_API_KEY` is set and valid
- Verify ticker symbol is correct (use standard symbols)
- Try broader time range (`--range 7d`)

### Rate limiting
- Brave Search API has rate limits
- Use `--cache` flag to cache results
- Reduce `max_results_per_category` in config

### Summarization failures
- Check LLM API key is set
- Fall back to excerpt mode: `--no-summarize`
- Check model availability

---

## Examples

### Morning Briefing Workflow

```bash
# 1. Generate digest
python {baseDir}/scripts/news_digest.py \
  --tickers AAPL,NVDA,MSFT,GOOGL,AMZN \
  --range 24h \
  --summarize \
  --format markdown \
  > /tmp/morning_digest.md

# 2. View in terminal
cat /tmp/morning_digest.md | less

# 3. Or open in browser
python -m markdown /tmp/morning_digest.md > /tmp/digest.html && open /tmp/digest.html
```

### Earnings Season Monitor

```bash
# Track earnings-specific news for tech holdings
python {baseDir}/scripts/news_digest.py \
  --tickers AAPL,GOOGL,META,AMZN,MSFT \
  --categories earnings,analyst \
  --range 7d \
  --format json \
  | jq '.articles[] | select(.impact == "high")'
```

### SEC Filing Alerts

```bash
# Monitor for new SEC filings
python {baseDir}/scripts/news_digest.py \
  --tickers AAPL \
  --categories sec_filings \
  --range 24h \
  --format json \
  | jq '.articles[] | {title, url, published}'
```
