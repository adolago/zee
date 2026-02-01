---
name: whoopskill
description: WHOOP CLI with health insights, trends analysis, and data fetching (sleep, recovery, HRV, strain).
version: 1.0.0
author: koala73
tags: [health, fitness, whoop, sleep, recovery]
source: clawhub
homepage: https://github.com/koala73/whoopskill
metadata: {"clawhub":{"id":"koala73/whoopskill","requires":{"bins":["node"],"env":["WHOOP_CLIENT_ID","WHOOP_CLIENT_SECRET","WHOOP_REDIRECT_URI"]},"install":[{"id":"npm","kind":"npm","package":"whoopskill","bins":["whoopskill"],"label":"Install whoopskill (npm)"}]}}
---

# whoopskill

Use `whoopskill` to fetch WHOOP health metrics (sleep, recovery, HRV, strain, workouts).

Install: `npm install -g whoopskill` | [GitHub](https://github.com/koala73/whoopskill)

Quick start
- `whoopskill summary` -- one-liner: Recovery: 52% | HRV: 39ms | Sleep: 40% | Strain: 6.7
- `whoopskill summary --color` -- color-coded summary with status indicators
- `whoopskill trends` -- 7-day trends with averages and direction arrows
- `whoopskill trends --days 30 --pretty` -- 30-day trend analysis
- `whoopskill insights --pretty` -- AI-style health recommendations
- `whoopskill --pretty` -- human-readable output
- `whoopskill recovery` -- recovery score, HRV, RHR
- `whoopskill sleep` -- sleep performance, stages
- `whoopskill workout` -- workouts with strain
- `whoopskill --date 2025-01-03` -- specific date

Analysis commands
- `summary` -- quick health snapshot (add `--color` for status indicators)
- `trends` -- multi-day averages with trend arrows
- `insights` -- personalized recommendations based on your data

Data types
- `profile` -- user info (name, email)
- `body` -- height, weight, max HR
- `sleep` -- sleep stages, efficiency, respiratory rate
- `recovery` -- recovery %, HRV, RHR, SpO2, skin temp
- `workout` -- strain, HR zones, calories
- `cycle` -- daily strain, calories

Combine types
- `whoopskill --sleep --recovery --body`

Auth
- `whoopskill auth login` -- OAuth flow (opens browser)
- `whoopskill auth status` -- check token status
- `whoopskill auth logout` -- clear tokens

Notes
- Output is JSON to stdout (use `--pretty` for human-readable)
- Tokens stored in `~/.whoop-cli/tokens.json` (auto-refresh)
- Uses WHOOP API v2
- Date follows WHOOP day boundary (4am cutoff)
- WHOOP apps with <10 users don't need review (immediate use)
