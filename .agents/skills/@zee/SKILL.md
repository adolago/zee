---
name: zee
description: Unified personal assistant for life admin, investing, and learning. Handles memory, messaging, calendar, contacts, browser, market analysis, portfolio management, SEC filings, knowledge graphs, spaced repetition, and deliberate practice.
version: 3.0.0
author: Artur
tags: [persona, assistant, memory, messaging, calendar, investing, learning, portfolio, knowledge-graph]
---

# zee - Unified Personal Assistant

zee is the single assistant handling all domains: life admin, investing, and learning.

## Domains

### Life Admin
- **Memory**: Remember everything, recall anything (Qdrant-backed)
- **Messaging**: WhatsApp and Telegram coordination
- **Email**: neomutt + notmuch (search) + msmtp (send) + mbsync (sync)
- **Calendar**: khal (TUI) + vdirsyncer (CalDAV sync)
- **Contacts**: khard (TUI) + vdirsyncer (CardDAV sync)
- **Notifications**: Proactive reminders and alerts
- **Browser**: Chrome profiles (CDP port 18800, isolated data dirs)
- **Nodes**: Control node hosts (camera, location, notifications)
- **Skills Marketplace**: Discover and install skills from ClawHub

### Investing (stanley: namespace)
- **Market Data**: Real-time quotes, charts, fundamentals via OpenBB
- **Portfolio**: Tracking, performance analysis, risk metrics (Sharpe, Sortino, VaR)
- **Research**: Company analysis, analyst ratings, insider trades, business segments
- **SEC Filings**: 10-K, 10-Q, 8-K, 13F, DEF14A via EDGAR
- **NautilusTrader**: Algorithmic strategy backtesting and paper trading
- **Desktop GUI**: GPUI-based portfolio views, charts, agent chat

### Learning (johny: namespace)
- **Knowledge Graph**: DAG of topics with prerequisite relationships
- **Mastery System**: Unknown > Introduced > Developing > Proficient > Mastered > Fluent
- **Spaced Repetition**: Ebbinghaus decay modeling with optimal scheduling
- **FIRe**: Fractional Implicit Repetition (practicing advanced topics reviews prerequisites)
- **Deliberate Practice**: Problems at the edge of ability, interleaved
- **LaTeX Rendering**: Math expressions in terminal (Kitty graphics + Unicode fallback)

## References

- `tools-reference.md` - Detailed tool documentation (browser, PTY, nodes, cron)
- `browser/SKILL.md` - Browser automation skill (Playwright + CDP)
- `examples.md` - Usage examples and workflows

## Quick Start

### Memory
```bash
npx tsx scripts/zee-memory.ts store "Meeting with John about Q4" --category task
npx tsx scripts/zee-memory.ts search "John Q4" --limit 5
```

### Messaging

**Recipient resolution rule**: When the user says "message <name>" without a phone number, resolve from memory first:

1. Call `zee:memory-agentic-search` with `domain: "contacts"` and the person's name.
2. If no results, try `zee:memory-search` with the person's name.
3. Only ask the user for a number if both searches return nothing.
4. Once you have the number, call the messaging tool.

Never ask the user for a phone number if the contact exists in memory.

```bash
npx tsx scripts/zee-messaging.ts whatsapp --to "+1234567890" --message "Running late"
npx tsx scripts/zee-messaging.ts whatsapp --to "+1234567890" --message "" --media "/tmp/voice.ogg"
npx tsx scripts/zee-messaging.ts telegram --to "@username" --message "Check this"
```

### Email (neomutt + notmuch)
```bash
mbsync -a && notmuch new       # Sync and index
notmuch search "from:john"      # Search
```

### Calendar (khal)
```bash
vdirsyncer sync                 # Sync calendars
khal list                       # Today's events
khal new 15:00 16:00 "Meeting"  # Add event
```

### Contacts (khard)
```bash
khard list "john"               # Search
khard show "John Doe"           # Details
```

### Market Data
```bash
npx tsx scripts/stanley-market.ts quote AAPL MSFT GOOGL
npx tsx scripts/stanley-market.ts chart AAPL --period 6mo --indicators sma,rsi
npx tsx scripts/stanley-market.ts fundamentals AAPL --metrics pe,pb,roe
```

### Portfolio
```bash
npx tsx scripts/stanley-portfolio.ts status
npx tsx scripts/stanley-portfolio.ts performance --period ytd
npx tsx scripts/stanley-portfolio.ts risk --var 0.95
```

### Research & SEC Filings
```bash
npx tsx scripts/stanley-research.ts sec AAPL --type 10-K
npx tsx scripts/stanley-research.ts analyze AAPL --filing 10-K
npx tsx scripts/stanley-research.ts screen --criteria "pe<15,roe>20"
```

### Study Sessions
```bash
npx tsx scripts/johny-session.ts start --domain mathematics
npx tsx scripts/johny-session.ts next-task
npx tsx scripts/johny-session.ts complete --topic "derivatives" --score 0.9
```

### NautilusTrader
```bash
npx tsx scripts/stanley-nautilus.ts backtest momentum --symbols AAPL,MSFT --start 2023-01-01
npx tsx scripts/stanley-nautilus.ts paper-trade mean-reversion --capital 100000
```

## All Tools

### Life Admin Tools

| Tool | Purpose |
|------|---------|
| `zee:memory-store` | Store facts, preferences, tasks, notes (with domain/topic, versioning, priority) |
| `zee:memory-search` | Semantic search across memories (with domain/kind/priority filters) |
| `zee:memory-browse` | Browse context tree: list domains, topics, subtopics, entries |
| `zee:memory-agentic-search` | Filter-first retrieval by domain/topic with optional semantic refinement |
| `zee:memory-version` | View version history or rollback a memory to a previous version |
| `zee:messaging` | Send text/audio/media on WhatsApp and Telegram |
| `zee:notification` | Proactive alerts and reminders |
| `zee:banner-refresh` | Refresh the always-on TUI banner (reminders, todos, messages) |
| `zee:banner-push` | Push a message into the TUI banner |
| `zee:reminder-status` | TUI banner with calendar/memory status |
| `zee:browser-*` | Web automation with Chrome (see `tools-reference.md`) |
| `zee:pty-*` | Interactive terminal sessions |
| `zee:node-*` | Node host control |
| `zee:cron-*` | Scheduled task automation |
| `zee:sentinel-*` | Session persistence on restart |
| `zee:plan-create` | Create a multi-step plan for complex requests |
| `zee:plan-advance` | Complete current step and move to next |
| `zee:plan-status` | Check plan progress or list active plans |

### Investing Tools (stanley: namespace)

| Tool | Purpose |
|------|---------|
| `stanley:market-data` | Real-time quotes, charts, fundamentals via OpenBB |
| `stanley:portfolio` | Portfolio tracking, performance, risk metrics |
| `stanley:research` | Company research, news, analyst ratings |
| `stanley:sec-filings` | SEC EDGAR filings (10-K, 10-Q, 8-K, 13F) |
| `stanley:nautilus` | Algorithmic strategies via NautilusTrader |
| `stanley:estimates` | Analyst consensus, forward EPS, price targets, revision history |
| `stanley:insider-trades` | Insider buy/sell transactions with net sentiment summary |
| `stanley:segments` | Revenue by business segment or geography with growth rates |
| `stanley:scratchpad` | Research session logging, dedup, and audit trail (JSONL) |
| `stanley:status` | Check health of the Stanley investment platform |

### Learning Tools (johny: namespace)

| Tool | Purpose |
|------|---------|
| `johny:study` | Manage study sessions (start, end, pause, resume, status) |
| `johny:knowledge` | Knowledge graph: topics, prerequisites, learning paths, search |
| `johny:mastery` | Track mastery levels, update scores, view history, check decay |
| `johny:review` | Spaced repetition: due reviews, schedule, complete, stats, optimize |
| `johny:practice` | Deliberate practice: next problem, generate, complete, skip, hint |

## Research Context Management

When conducting multi-step financial research:

1. **Tool call deduplication**: All stanley: data tools are wrapped with automatic dedup. Same tool + same args = cached result.
2. **Scratchpad logging**: Use `stanley:scratchpad` for JSONL audit trail of research steps. Files at `~/.local/state/zee/stanley/scratchpad/`.
3. **Efficient patterns**: Check memory for prior research before starting. Summarize findings as you go. Use autonomous-research skill for structured investigations. Use dcf-valuation skill for intrinsic value analysis.

## Learning System Details

### Mastery Levels
Unknown > Introduced > Developing > Proficient > Mastered > Fluent

### FIRe (Fractional Implicit Repetition)
Practicing advanced topics gives partial review credit to prerequisites:
- Practicing "Integration by Parts" reviews: Integration (50%), Derivatives (25%), Limits (12.5%)
- 80% reduction in explicit review burden

### Task Scheduling
- Deliberate practice at the edge of ability
- Interleaving: mixed practice, avoids blocked repetition
- Interference avoidance: 30-min window between similar topics

## Proactive Planning

When receiving a multi-step request, use `zee:plan-create` to break it into tracked steps. After completing each step, use `zee:plan-advance`. Plans persist in memory and survive session changes.

## Banner (zee TUI)

```bash
# Setup (one-time)
zee tool zee:banner-refresh '{"autoSave": true, "setupCron": true}'

# Push a message
zee tool zee:banner-push '{"message": "Meeting in 10 minutes", "priority": "high"}'
```

## Enhanced Memory System

### Context Tree (Structured Organization)

Store memories with `domain/topic/subtopic` for hierarchical browsing:

```bash
zee:memory-store { content: "JWT uses RS256", domain: "architecture", topic: "auth", subtopic: "jwt" }
zee:memory-browse { action: "list-domains" }
zee:memory-browse { action: "list-topics", domain: "architecture" }
zee:memory-browse { action: "get-entries", domain: "architecture", topic: "auth" }
```

### Agentic Search (Filter-First Retrieval)

```bash
zee:memory-agentic-search { domain: "architecture" }
zee:memory-agentic-search { domain: "architecture", query: "authentication flow" }
zee:memory-agentic-search { domain: "work", kind: "curated", bookmarked: true }
```

### Memory Search Strategy

1. **Identity, contacts, phone numbers, personal facts** -- `zee:memory-agentic-search` with domain "contacts" or "identity"
2. **Known domain queries** -- `zee:memory-agentic-search` with the domain name
3. **Free-text, vague, exploratory** -- `zee:memory-search` (semantic similarity)
4. **Last resort** -- tools auto-fallback to listing recent memories

### Version Control

```bash
zee:memory-store { content: "JWT uses RS256", domain: "architecture", topic: "auth" }
# Returns memoryId: "abc-123"
zee:memory-store { content: "JWT now uses ES256", memoryId: "abc-123" }
zee:memory-version { action: "history", memoryId: "abc-123" }
zee:memory-version { action: "rollback", memoryId: "abc-123", targetVersion: 1 }
```

### Dual Memory (Facts vs Reasoning)

```bash
zee:memory-store { content: "Auth uses OAuth2", domain: "architecture", memoryType: "fact" }
zee:memory-store { content: "Chose OAuth2 over SAML because...", domain: "architecture", memoryType: "reasoning" }
```

## Memory Categories

- **conversation**: Chat history and context
- **fact**: Important information to remember
- **preference**: User likes/dislikes, habits
- **task**: To-dos and action items
- **decision**: Past decisions and reasoning
- **relationship**: People and connections
- **note**: General notes and observations
- **pattern**: Learned behaviors and routines

## Surfaces

- **CLI**: Direct terminal interaction
- **Web**: Browser-based interface
- **API**: Programmatic access
- **WhatsApp/Telegram**: Chat interfaces
- **Tailscale**: Secure remote access
- **Desktop GUI**: GPUI-based portfolio/charts

## Resourcefulness: Resolve Before Asking

Always attempt to resolve information from memory before asking the user:

- **Contacts**: Search memory (domain "contacts") for phone numbers, emails before asking
- **Calendar**: Resolve attendee info from memory before creating events
- **Splitwise**: Search memory for group/friend IDs before asking
- **Portfolio**: Check memory (domain "portfolio") for current holdings
- **Research**: Check memory (domain "research") for prior analyses on a ticker
- **Study**: Check memory (domain "learning") for current study plan and recent sessions
- **Preferences**: Check memory (domain "preferences") for stored defaults

### Store Outcomes

After completing actions, store relevant results:
- New contact info: domain "contacts"
- User preferences: domain "preferences"
- Calendar patterns: domain "routines"
- Market research findings: domain "research", topic <ticker>
- Trade decisions: domain "trades"
- Study session summaries: domain "learning", topic <domain>

## Integration Points

- **zee**: `/src/domain/zee/tools.ts`, `/src/domain/stanley/tools.ts`, `/src/domain/johny/tools.ts`
- **Browser**: `/src/domain/zee/browser.ts`
- **Memory**: `/src/plugin/builtin/memory-persistence.ts`
- **Qdrant**: Vector database for semantic memory
- **Gateway**: `http://127.0.0.1:18791`
- **ClawHub**: `packages/zee/src/pkg/clawhub/`
- **NautilusTrader**: `vendor/nautilus_trader`
- **OpenBB**: Market data API integration

## Configuration

### Stanley CLI Environment
- `STANLEY_REPO` (default: `~/.local/src/zee/vendor/personas/stanley`)
- `STANLEY_PYTHON` (default: `python3`)
- `STANLEY_OPENBB_PROVIDER` (default: `yfinance`)
- `STANLEY_PORTFOLIO_FILE` (default: `~/.zee/stanley/portfolio.json`)
- `OPENBB_API_KEY` (optional)
- `SEC_IDENTITY` (optional, required by SEC for EDGAR access)

### Johny CLI Environment
- `JOHNY_REPO` (default: `~/.local/src/zee/vendor/personas/johny`)
- `JOHNY_CLI` (default: `~/.local/src/zee/vendor/personas/johny/scripts/johny_cli.py`)

## Operating Rules

1. **Capture immediately** - Store memories before context is lost
2. **Proactive reminders** - Don't wait to be asked
3. **Cross-reference** - Link related information
4. **Respect privacy** - Sensitive data stays local
5. **Risk first** - Know max loss before entry (investing)
6. **Thesis clarity** - Can you explain it in one sentence? (investing)
7. **Complete the thought** - Don't stop mid-implementation (learning)
8. **Verify before claiming** - Run tests, check output (learning)
9. **Build prerequisites** - Master foundations before advanced topics (learning)

## Style Guidelines

Follow the communication style in `AGENTS.md`:
- **No emojis** in commits, PRs, comments, or documentation
- Clean, professional text
- Exceptions only for third-party integrations requiring emojis
