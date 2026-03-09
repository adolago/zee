"""
Templates Module

Pre-built templates for investment thesis, trade journal,
company research, and other note types.
"""

from datetime import datetime, timedelta
from typing import Optional

from .models import (
    ConvictionLevel,
    EventFrontmatter,
    EventType,
    NoteFrontmatter,
    NoteType,
    PersonFrontmatter,
    SectorFrontmatter,
    ThesisFrontmatter,
    ThesisStatus,
    TradeFrontmatter,
    TradeDirection,
    TradeStatus,
)


class Templates:
    """Pre-built note templates following best practices."""

    @staticmethod
    def investment_thesis(
        symbol: str,
        company_name: str = "",
        sector: str = "",
        conviction: ConvictionLevel = ConvictionLevel.MEDIUM,
    ) -> tuple[ThesisFrontmatter, str]:
        """
        Create an investment thesis template.

        Args:
            symbol: Stock symbol
            company_name: Company name
            sector: Sector/industry
            conviction: Initial conviction level

        Returns:
            Tuple of (frontmatter, content)
        """
        frontmatter = ThesisFrontmatter(
            title=f"{symbol} Investment Thesis",
            symbol=symbol.upper(),
            company_name=company_name,
            sector=sector,
            status=ThesisStatus.RESEARCH,
            conviction=conviction,
            tags=["thesis", sector.lower().replace(" ", "-")] if sector else ["thesis"],
        )

        content = f"""# {symbol} Investment Thesis

## Executive Summary

_One paragraph summary of the investment thesis._

## Company Overview

**Company:** {company_name or symbol}
**Sector:** {sector}
**Market Cap:**
**Current Price:**

## Investment Thesis

### Core Thesis

_What is the main reason to own this stock?_

### Key Investment Merits

1. **Merit 1:**
2. **Merit 2:**
3. **Merit 3:**

## Valuation

### Current Valuation

| Metric | Value | Sector Avg | Comment |
|--------|-------|------------|---------|
| P/E | | | |
| EV/EBITDA | | | |
| P/FCF | | | |
| P/B | | | |

### Target Price Derivation

_How did you arrive at your target price?_

**Base Case:** $
**Bull Case:** $
**Bear Case:** $

## Catalysts

### Near-term (0-6 months)

-

### Medium-term (6-18 months)

-

## Risks

### Key Risks

1. **Risk 1:**
   - Mitigation:
2. **Risk 2:**
   - Mitigation:
3. **Risk 3:**
   - Mitigation:

### What Would Invalidate the Thesis?

_Under what conditions would you exit the position?_

## Competitive Analysis

### Competitive Position

_Moat, market share, competitive advantages_

### Key Competitors

- [[Competitor 1]]
- [[Competitor 2]]

## Financial Analysis

### Revenue & Growth

_Historical growth, drivers, sustainability_

### Margins & Profitability

_Gross margin, operating margin, trends_

### Balance Sheet

_Debt levels, liquidity, capital allocation_

### Cash Flow

_FCF generation, uses of cash_

## Management

### Leadership Assessment

_Quality of management, track record, alignment_

### Capital Allocation History

_Buybacks, dividends, M&A track record_

## Position Sizing

**Conviction Level:** {conviction.value}
**Suggested Position Size:** % of portfolio
**Entry Strategy:**

## Updates & Developments

### {datetime.now().strftime("%Y-%m-%d")} - Initial Thesis

_Initial thesis creation._

---

## Related Notes

- [[{sector} Sector Overview]] (if exists)
- [[Trades/{symbol}]] (trade journal entries)

## Sources

-
"""
        return frontmatter, content

    @staticmethod
    def trade_journal(
        symbol: str,
        direction: TradeDirection = TradeDirection.LONG,
        entry_price: float = 0.0,
        shares: float = 0.0,
        entry_date: Optional[datetime] = None,
    ) -> tuple[TradeFrontmatter, str]:
        """
        Create a trade journal entry template.

        Args:
            symbol: Stock symbol
            direction: Long or short
            entry_price: Entry price
            shares: Number of shares
            entry_date: Entry date

        Returns:
            Tuple of (frontmatter, content)
        """
        entry_date = entry_date or datetime.now()
        title = (
            f"{symbol} {direction.value.title()} - {entry_date.strftime('%Y-%m-%d')}"
        )

        frontmatter = TradeFrontmatter(
            title=title,
            symbol=symbol.upper(),
            direction=direction,
            status=TradeStatus.OPEN,
            entry_date=entry_date,
            entry_price=entry_price,
            shares=shares,
            tags=["trade", direction.value],
        )

        content = f"""# {title}

## Trade Summary

**Symbol:** {symbol.upper()}
**Direction:** {direction.value.title()}
**Entry Date:** {entry_date.strftime("%Y-%m-%d")}
**Entry Price:** ${entry_price:.2f}
**Shares:** {shares}
**Position Value:** ${entry_price * shares:.2f}

## Entry Rationale

### Why This Trade?

_What triggered the entry?_

### Link to Thesis

- [[Theses/{symbol} Investment Thesis]]

### Technical Setup (if applicable)

_Chart patterns, levels, indicators_

### Catalyst

_What catalyst are you playing?_

## Risk Management

### Stop Loss

**Stop Price:** $
**Max Loss:** $
**Risk/Reward:**

### Position Size Justification

_Why this size?_

## Trade Management Plan

### Profit Targets

1. Target 1: $ (% of position)
2. Target 2: $ (% of position)
3. Target 3: $ (% of position)

### Scaling Plan

_When/how will you add or reduce?_

## Pre-Trade Checklist

- [ ] Thesis is current and valid
- [ ] Position size appropriate for conviction
- [ ] Stop loss defined
- [ ] Profit targets set
- [ ] No upcoming binary events (unless intentional)
- [ ] Portfolio exposure acceptable

## Emotional Check-In

**Confidence Level:** /10
**Emotional State:**
**FOMO/Fear Factor:**

## Trade Updates

### {entry_date.strftime("%Y-%m-%d")} - Entry

Entered {direction.value} position at ${entry_price:.2f}

---

## Exit (Complete When Closed)

**Exit Date:**
**Exit Price:** $
**P&L:** $
**P&L %:**
**Holding Period:** days

### Exit Rationale

_Why did you exit?_

### What Went Well

-

### What Could Be Improved

-

### Lessons Learned

_Key takeaways for future trades_

### Grade: /10

_Self-assessment of trade execution_
"""
        return frontmatter, content

    @staticmethod
    def company_research(
        symbol: str,
        company_name: str = "",
        sector: str = "",
    ) -> tuple[NoteFrontmatter, str]:
        """
        Create a company research note template.

        Args:
            symbol: Stock symbol
            company_name: Company name
            sector: Sector/industry

        Returns:
            Tuple of (frontmatter, content)
        """
        frontmatter = NoteFrontmatter(
            title=f"{company_name or symbol} Research",
            note_type=NoteType.COMPANY,
            tags=(
                ["company", sector.lower().replace(" ", "-")] if sector else ["company"]
            ),
            extra={"symbol": symbol.upper(), "sector": sector},
        )

        content = f"""# {company_name or symbol} Research

## Company Profile

**Symbol:** {symbol.upper()}
**Company:** {company_name}
**Sector:** {sector}
**Industry:**
**Founded:**
**Headquarters:**
**Employees:**
**Website:**

## Business Description

_What does the company do?_

## Business Segments

| Segment | Revenue % | Description |
|---------|-----------|-------------|
| | | |

## Key Metrics

| Metric | Value | Trend |
|--------|-------|-------|
| Revenue | | |
| Net Income | | |
| FCF | | |
| Gross Margin | | |
| Operating Margin | | |
| ROE | | |
| Debt/Equity | | |

## Competitive Position

### Market Share

### Competitors

- [[Competitor 1]]
- [[Competitor 2]]
- [[Competitor 3]]

### Competitive Advantages (Moat)

1.
2.
3.

## Management

**CEO:**
**CFO:**
**Key Executives:**

### Insider Ownership

### Compensation Alignment

## Recent Developments

### Earnings History

| Quarter | EPS | Rev | Surprise |
|---------|-----|-----|----------|
| | | | |

### News & Events

-

## SEC Filings

- [[10-K {datetime.now().year}]]
- [[10-Q Latest]]
- [[Proxy Statement]]

## Institutional Ownership

### Top Holders

1.
2.
3.

### Recent Changes

## Analyst Coverage

| Analyst | Rating | Target |
|---------|--------|--------|
| | | |

## Related Notes

- [[Theses/{symbol} Investment Thesis]]
- [[{sector} Sector Overview]]
"""
        return frontmatter, content

    @staticmethod
    def sector_overview(
        sector: str,
        description: str = "",
    ) -> tuple[NoteFrontmatter, str]:
        """
        Create a sector overview template.

        Args:
            sector: Sector name
            description: Brief description

        Returns:
            Tuple of (frontmatter, content)
        """
        frontmatter = NoteFrontmatter(
            title=f"{sector} Sector Overview",
            note_type=NoteType.SECTOR,
            tags=["sector", sector.lower().replace(" ", "-")],
        )

        content = f"""# {sector} Sector Overview

## Sector Description

{description or "_Overview of the sector and its role in the economy._"}

## Key Characteristics

- **Cyclicality:**
- **Capital Intensity:**
- **Regulatory Environment:**
- **Growth Profile:**

## Industry Structure

### Market Size

**TAM:** $
**Growth Rate:** %

### Value Chain

_Description of the industry value chain_

### Key Players

| Company | Market Cap | Market Share |
|---------|------------|--------------|
| [[Company 1]] | | |
| [[Company 2]] | | |
| [[Company 3]] | | |

## Sector Drivers

### Demand Drivers

1.
2.
3.

### Supply Factors

1.
2.

## Sector Risks

1.
2.
3.

## Valuation Benchmarks

| Metric | Sector Avg | Range |
|--------|------------|-------|
| P/E | | |
| EV/EBITDA | | |
| P/B | | |
| Div Yield | | |

## Current Sector View

**Outlook:** Bullish / Neutral / Bearish
**Reasoning:**

## Macro Sensitivity

### Interest Rates

### Economic Cycle

### Commodity Prices

## ETFs & Indices

| Symbol | Name | Expense |
|--------|------|---------|
| | | |

## Companies Covered

```dataview
TABLE symbol, status, conviction
FROM "Theses"
WHERE sector = "{sector}"
SORT modified DESC
```

## Recent Sector News

-

## Related Notes

- [[Macro Environment]]
"""
        return frontmatter, content

    @staticmethod
    def daily_note(
        date: Optional[datetime] = None,
    ) -> tuple[NoteFrontmatter, str]:
        """
        Create a daily note template.

        Args:
            date: Date for the note (defaults to today)

        Returns:
            Tuple of (frontmatter, content)
        """
        date = date or datetime.now()
        title = date.strftime("%Y-%m-%d")

        frontmatter = NoteFrontmatter(
            title=title,
            note_type=NoteType.DAILY,
            tags=["daily"],
        )

        content = f"""# {title}

## Market Overview

### Major Indices

| Index | Close | Change |
|-------|-------|--------|
| S&P 500 | | |
| Nasdaq | | |
| Russell 2000 | | |
| VIX | | |

### Sector Performance

_Best/worst sectors today_

## Portfolio Review

### Open Positions

_Quick check on open positions_

### P&L Today

**Realized:** $
**Unrealized:** $

## Market Notes

### Key Themes

-

### Notable Movers

-

### Economic Data

-

## Trade Ideas

### New Ideas

-

### Watchlist Updates

-

## Research Notes

_Notes from research done today_

## Tomorrow's Focus

- [ ]
- [ ]

## Reflection

_What went well? What could improve?_

---

<< [[{(date - timedelta(days=1)).strftime("%Y-%m-%d")}]] | [[{(date + timedelta(days=1)).strftime("%Y-%m-%d")}]] >>
"""
        return frontmatter, content

    @staticmethod
    def meeting_notes(
        title: str,
        company: str = "",
        attendees: str = "",
    ) -> tuple[NoteFrontmatter, str]:
        """
        Create a meeting notes template.

        Args:
            title: Meeting title
            company: Company discussed
            attendees: Meeting attendees

        Returns:
            Tuple of (frontmatter, content)
        """
        frontmatter = NoteFrontmatter(
            title=title,
            note_type=NoteType.MEETING,
            tags=["meeting"],
            extra={"company": company, "attendees": attendees},
        )

        date = datetime.now().strftime("%Y-%m-%d")

        content = f"""# {title}

**Date:** {date}
**Company:** {company}
**Attendees:** {attendees}
**Type:** Earnings Call / Investor Day / 1-on-1 / Conference

## Key Takeaways

1.
2.
3.

## Detailed Notes

### Topic 1

### Topic 2

### Topic 3

## Q&A Highlights

### Question 1

**Q:**
**A:**

## Management Tone

_Assessment of management confidence, body language, etc._

## Implications for Thesis

_How does this affect your investment thesis?_

## Action Items

- [ ]
- [ ]

## Related Notes

- [[Companies/{company}]]
- [[Theses/{company} Investment Thesis]]
"""
        return frontmatter, content

    @staticmethod
    def event_note(
        symbol: str,
        company_name: str = "",
        event_type: EventType = EventType.CONFERENCE,
        event_date: Optional[datetime] = None,
        host: str = "",
        participants: list = None,
    ) -> tuple[EventFrontmatter, str]:
        """
        Create an event note template (conference call, investor day, etc.).

        Args:
            symbol: Stock symbol
            company_name: Company name
            event_type: Type of event
            event_date: Event date
            host: Bank/broker hosting the event
            participants: List of participants (executives)

        Returns:
            Tuple of (frontmatter, content)
        """
        event_date = event_date or datetime.now()
        participants = participants or []

        event_type_names = {
            EventType.EARNINGS_CALL: "Earnings Call",
            EventType.INVESTOR_DAY: "Investor Day",
            EventType.CONFERENCE: "Conference",
            EventType.ANALYST_MEETING: "Analyst Meeting",
            EventType.SITE_VISIT: "Site Visit",
            EventType.AGM: "Annual General Meeting",
            EventType.GUIDANCE_UPDATE: "Guidance Update",
            EventType.M_AND_A: "M&A Announcement",
            EventType.OTHER: "Event",
        }

        event_name = event_type_names.get(event_type, "Event")
        title = f"{symbol} - {event_name} - {event_date.strftime('%Y-%m-%d')}"
        if host:
            title = f"{symbol} - {host} {event_name}"

        frontmatter = EventFrontmatter(
            title=title,
            event_type=event_type,
            event_date=event_date,
            company=f"[[{company_name or symbol}]]",
            symbol=symbol.upper(),
            participants=[f"[[{p}]]" for p in participants],
            host=host,
            tags=["event", event_type.value, f"company/{symbol.lower()}"],
        )

        participants_md = (
            "\n".join([f"- [[{p}]]" for p in participants])
            if participants
            else "- _Add participants_"
        )

        content = f"""# {title}

## Event Details

**Date:** {event_date.strftime("%Y-%m-%d")}
**Company:** [[{company_name or symbol}]]
**Type:** {event_name}
**Host:** {host or "_Bank/Broker_"}

## Participants

{participants_md}

---

## Key Takeaways

1. **Takeaway 1:**
2. **Takeaway 2:**
3. **Takeaway 3:**

## Detailed Notes

### Opening Remarks

_Management's opening statement_

### Business Update

_Operational and financial highlights_

### Strategic Priorities

_Key strategic initiatives discussed_

### Guidance & Outlook

_Forward-looking statements and guidance_

| Metric | Previous | Current | Change |
|--------|----------|---------|--------|
| Revenue | | | |
| EBITDA | | | |
| Margins | | | |

## Q&A Session

### Q1: _Question Topic_

**Analyst:** _Name @ Firm_
**Q:** _Question_
**A:** _Management response_

### Q2: _Question Topic_

**Analyst:** _Name @ Firm_
**Q:** _Question_
**A:** _Management response_

### Q3: _Question Topic_

**Analyst:** _Name @ Firm_
**Q:** _Question_
**A:** _Management response_

## Management Tone Assessment

| Aspect | Rating | Notes |
|--------|--------|-------|
| Confidence | /10 | |
| Transparency | /10 | |
| Defensiveness | /10 | |
| Forward Outlook | Bullish / Neutral / Cautious | |

## Competitive Commentary

_Any mentions of competitors, market dynamics_

## Thesis Implications

### Supporting Evidence

-

### Challenging Evidence

-

### Thesis Update Required?

- [ ] Yes - Update [[Theses/{symbol} Investment Thesis]]
- [ ] No - Thesis remains intact

## Action Items

- [ ] Update financial model
- [ ] Review competitor commentary
- [ ] Follow up on specific metrics
- [ ] Schedule next touchpoint

## Key Quotes

> "_Important management quote_"
> — _Executive Name, Role_

## Related Notes

- [[{company_name or symbol}]]
- [[Theses/{symbol} Investment Thesis]]
- [[Sectors/_Sector Name_]]
"""
        return frontmatter, content

    @staticmethod
    def person_profile(
        full_name: str,
        current_role: str = "",
        current_company: str = "",
        linkedin_url: str = "",
    ) -> tuple[PersonFrontmatter, str]:
        """
        Create a person/executive profile template.

        Args:
            full_name: Person's full name
            current_role: Current role (CEO, CFO, IR, etc.)
            current_company: Current company
            linkedin_url: LinkedIn profile URL

        Returns:
            Tuple of (frontmatter, content)
        """
        frontmatter = PersonFrontmatter(
            title=full_name,
            full_name=full_name,
            current_role=current_role,
            current_company=f"[[{current_company}]]" if current_company else "",
            linkedin_url=linkedin_url,
            tags=(
                [
                    "person",
                    "executive",
                    f"company/{current_company.lower().replace(' ', '_')}",
                ]
                if current_company
                else ["person"]
            ),
        )

        content = f"""# {full_name}

## Profile

**Name:** {full_name}
**Current Role:** {current_role or "_Role_"}
**Company:** [[{current_company}]]
**LinkedIn:** [{linkedin_url}]({linkedin_url}) {{{{ if linkedin_url }}}}

---

## Career History

| Period | Role | Company | Notes |
|--------|------|---------|-------|
| Present | {current_role} | [[{current_company}]] | Current position |
| | | | |
| | | | |

## Background

### Education

-

### Professional Experience

_Key career highlights before current role_

---

## Assessment

### Management Style

_How do they lead? Operational focus vs strategic? Hands-on vs delegator?_

### Communication Style

| Aspect | Assessment |
|--------|------------|
| Transparency | High / Medium / Low |
| Candor on Challenges | |
| Forward Guidance | Conservative / Balanced / Aggressive |
| Analyst Relations | |

### Track Record

#### Promises vs. Delivery

| What They Said | When | Outcome | Score |
|----------------|------|---------|-------|
| | | | |

#### Capital Allocation Decisions

_Key decisions on M&A, buybacks, dividends, capex_

### Red Flags

- [ ] Frequent narrative changes
- [ ] Over-promising, under-delivering
- [ ] Defensive in Q&A
- [ ] Avoiding difficult questions
- [ ] High turnover in team
- [ ] Related party transactions

**Notes:**

### Green Flags

- [ ] Consistent messaging over time
- [ ] Acknowledges mistakes
- [ ] Skin in the game (ownership)
- [ ] Long tenure
- [ ] Strong team stability
- [ ] Clear capital allocation framework

**Notes:**

---

## Key Quotes

> "_Notable quote from this person_"
> — {full_name}, _Context/Event_

---

## Event Appearances

_Events where this person presented or participated:_

- [[Events/YYYY-MM-DD - Event]]

---

## Network

### Associated Executives

_Other executives frequently appearing with this person:_

- [[Person Name]] - _Role @ Company_

### Board Positions

_Other boards this person serves on:_

---

## Notes

_Personal observations, insights from meetings, etc._

---

## Related

- [[{current_company}]]
- [[Theses/{current_company} Investment Thesis]]
"""
        return frontmatter, content

    @staticmethod
    def sector_overview_enhanced(
        sector_name: str,
        sub_sectors: list = None,
        companies: list = None,
    ) -> tuple[SectorFrontmatter, str]:
        """
        Create an enhanced sector overview template with moat analysis.

        Args:
            sector_name: Sector name (e.g., "Health Care", "Financials")
            sub_sectors: List of sub-sectors
            companies: List of companies covered

        Returns:
            Tuple of (frontmatter, content)
        """
        sub_sectors = sub_sectors or []
        companies = companies or []

        frontmatter = SectorFrontmatter(
            title=f"{sector_name} Sector Overview",
            sector_name=sector_name,
            sub_sectors=sub_sectors,
            companies_covered=[f"[[{c}]]" for c in companies],
            tags=["sector", sector_name.lower().replace(" ", "-")],
        )

        companies_md = (
            "\n".join([f"| [[{c}]] | | | | |" for c in companies])
            if companies
            else "| | | | | |"
        )
        sub_sectors_md = (
            "\n".join([f"- {s}" for s in sub_sectors])
            if sub_sectors
            else "- _Add sub-sectors_"
        )

        content = f"""# {sector_name} Sector Overview

## Sector Profile

**Sector:** {sector_name}
**Last Updated:** {datetime.now().strftime("%Y-%m-%d")}

### Sub-Sectors

{sub_sectors_md}

---

## Market Structure

### Size & Growth

| Metric | Value | Source |
|--------|-------|--------|
| Market Size (TAM) | $ | |
| Growth Rate (CAGR) | % | |
| Penetration | % | |

### Industry Characteristics

| Characteristic | Assessment |
|----------------|------------|
| Cyclicality | Cyclical / Defensive / Mixed |
| Capital Intensity | High / Medium / Low |
| Regulatory Environment | Heavy / Moderate / Light |
| Growth Profile | High Growth / Mature / Declining |
| Concentration | Fragmented / Oligopoly / Monopoly |

---

## Competitive Landscape

### Key Players

| Company | Market Cap | Market Share | Moat Rating | Status |
|---------|------------|--------------|-------------|--------|
{companies_md}

### Business Model Comparison

| Model | Players | Pros | Cons | Typical Margins |
|-------|---------|------|------|-----------------|
| Model A | | | | |
| Model B | | | | |

---

## Moat Analysis

### Common Moat Sources in {sector_name}

| Moat Source | Prevalence | Key Examples |
|-------------|------------|--------------|
| Intangible Assets (brands, patents) | | |
| Cost Advantages (scale, process) | | |
| Switching Costs | | |
| Network Effects | | |
| Efficient Scale | | |

### Moat Sustainability Factors

_What determines whether moats persist in this sector?_

---

## Valuation Benchmarks

| Metric | Sector Avg | Range | Premium Players | Discount Players |
|--------|------------|-------|-----------------|------------------|
| P/E | x | - | | |
| EV/EBITDA | x | - | | |
| P/B | x | - | | |
| Div Yield | % | - | | |
| EV/Revenue | x | - | | |

### What Justifies Premium Valuations?

1.
2.
3.

---

## Key Value Drivers

### Demand Drivers

1.
2.
3.

### Supply Factors

1.
2.

### Macro Sensitivity

| Factor | Impact | Direction |
|--------|--------|-----------|
| Interest Rates | High / Medium / Low | |
| GDP Growth | | |
| Currency | | |
| Commodity Prices | | |
| Regulation | | |

---

## Investment Themes & Debates

### Theme 1: _Theme Name_

**Bulls:**
-

**Bears:**
-

### Theme 2: _Theme Name_

**Bulls:**
-

**Bears:**
-

### Key Questions

1. _Open question about the sector_
2.
3.

---

## Current Sector View

**Outlook:** Bullish / Neutral / Bearish
**Conviction:** High / Medium / Low

### Rationale

_Why this view?_

### Catalysts

| Catalyst | Timeline | Impact |
|----------|----------|--------|
| | | |

### Risks

| Risk | Probability | Impact |
|------|-------------|--------|
| | | |

---

## Companies Coverage

### Detailed Coverage

```dataview
TABLE symbol, status, conviction, moat_rating
FROM "Theses"
WHERE sector = "{sector_name}"
SORT modified DESC
```

### Quick Reference

| Company | Thesis Status | Conviction | Key Debate |
|---------|---------------|------------|------------|
{companies_md}

---

## Recent Developments

### {datetime.now().strftime("%Y-%m")}

-

---

## Related Notes

- [[Macro Environment]]
- [[Market Overview]]
"""
        return frontmatter, content
