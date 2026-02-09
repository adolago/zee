---
name: personas
description: Skill catalog and tool reference for Zee, the unified personal assistant. All tools from all domains are available directly.
version: 3.0.0
author: Artur
tags: [personas, identity, catalog]
---

# Zee - Unified Assistant

Zee is the single assistant handling all domains. The former Stanley (investing) and Johny (learning) personas have been consolidated into Zee. Their tool namespaces (`stanley:*`, `johny:*`) are preserved for clarity but all tools load unconditionally.

## Complete Skill Catalog

### Zee Skills (life admin)
- `zee` - Memory, messaging (WhatsApp/Telegram/Matrix E2EE), email (neomutt/notmuch), calendar (khal), contacts (khard), browser (Chrome), nodes, ClawHub marketplace
- `home-assistant` - Smart home control via hass-cli or REST API [via clawhub: dbhurley/homeassistant]
- `obsidian` - Obsidian vault management [via clawhub: steipete/obsidian]
- `agent-browser` - Headless browser automation CLI [via clawhub: TheSethRose/agent-browser]
- `wacli` - WhatsApp CLI for messaging and history search [via clawhub: steipete/wacli]
- `weather` - Weather forecasts via wttr.in and Open-Meteo [via clawhub: steipete/weather]
- `spotify-player` - Terminal Spotify playback/search [via clawhub: steipete/spotify-player]
- `food-order` - Foodora reorder + ETA tracking [via clawhub: steipete/food-order]
- `caldav-calendar` - CalDAV calendar sync/query [via clawhub: Asleep123/caldav-calendar]
- `whoopskill` - WHOOP health metrics: sleep, recovery, HRV, strain [via clawhub: koala73/whoopskill]

### Investing Skills (stanley: namespace)
- `stanley` - Market data (OpenBB), portfolio tracking, SEC EDGAR filings, NautilusTrader strategies, GPUI desktop GUI
- `stock-market-pro` - Yahoo Finance price tracking, charts, fundamentals [via clawhub: kys42/stock-market-pro]
- `autonomous-research` - Structured multi-step financial investigations
- `dcf-valuation` - Discounted cash flow intrinsic value analysis
- `investment-thesis` - Structured thesis building and tracking
- `portfolio-analytics` - Advanced portfolio analytics and reporting
- `risk-management` - Position sizing, risk assessment, stop-loss management
- `market-analysis` - Market analysis workflows
- `financial-research` - Financial research workflows
- `earnings-intelligence` - Earnings analysis and tracking
- `news-digest` - News aggregation and summarization

### Learning Skills (johny: namespace)
- `johny` - Knowledge graph (DAG with prerequisites), mastery system, FIRe, deliberate practice, spaced repetition
- `latex-rendering` - Render LaTeX math in the TUI with Kitty graphics and Unicode fallback
- `coding-agent` - Run Codex CLI, Claude Code, OpenCode as background coding agents [via clawhub: steipete/coding-agent]
- `concept-exploration` - Deep concept exploration and explanation
- `github` - GitHub workflow integration
- `oracle` - Oracle protocol for codebase understanding
- `qmd` - Quarto markdown rendering
- `session-logs` - Study session logging and review
- `skill-builder` - Skill creation and management
- `problem-solving` - Structured problem-solving methodology
- `progress-tracking` - Learning progress tracking and visualization
- `deliberate-practice` - Deliberate practice session management

### Shared Skills
- `personas` - This catalog. Skill reference.
- `auto-updater` - Daily auto-update of agent-core and skills via cron [via clawhub: maximeprades/auto-updater]
- `self-improving-agent` - Log learnings, errors, corrections [via clawhub: pskoett/self-improving-agent]
- `tmux` - Remote-control tmux sessions [via clawhub: steipete/tmux]
- `humanizer` - Remove AI writing patterns [via clawhub: biostartechnology/humanizer]
- `markdown-converter` - Convert PDF/Word/Excel/HTML to Markdown [via clawhub: steipete/markdown-converter]
- `clawddocs` - Documentation search and navigation [via clawhub: NicholasSpisak/clawddocs]

## Tool Namespaces

Tools use namespaced IDs for clarity. All load unconditionally under Zee:

| Namespace | Domain | Example Tools |
|-----------|--------|---------------|
| `zee:*` | Life admin | memory-store, messaging, browser-*, cron-* |
| `stanley:*` | Investing | market-data, portfolio, sec-filings, nautilus |
| `johny:*` | Learning | study, knowledge, mastery, review, practice |

## Cross-Domain Memory

All domains share the same Qdrant vector store. Store with clear domain/topic tags so information is findable across contexts:

- Market research: domain "research", topic <ticker>
- Study sessions: domain "learning", topic <subject>
- Contacts: domain "contacts"
- Preferences: domain "preferences"

**Resolve before asking**: Always search memory before asking the user for information.

**Store outcomes**: After completing actions, store relevant results for future reference.

## MCP Servers

- `memory` - Qdrant-backed semantic memory
- `calendar` - Google Calendar integration
- `portfolio` - Portfolio tracking and analytics
- `context7` - Library documentation search

## Technical Reference

Tool implementations:
- `src/domain/zee/tools.ts` - Life admin tools
- `src/domain/stanley/tools.ts` - Investing tools
- `src/domain/johny/tools.ts` - Learning tools
- `src/personas/persona.ts` - Persona configuration

## Style Guidelines

Follow the communication style in `AGENTS.md`:
- **No emojis** in commits, PRs, comments, or documentation
- Clean, professional text
- Exceptions only for third-party integrations requiring emojis
