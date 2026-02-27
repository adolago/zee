---
name: daily-briefing
description: "Morning and evening daily briefings combining calendar, tasks, email, and study tracking. Use when starting the day, ending the day, or when the user asks for a status update, morning review, or daily summary."
version: 1.0.0
author: Artur
tags: [routine, morning, evening, briefing, tasks, calendar, email, productivity, zee]
---

# Daily Briefing

Structured morning and evening routines that aggregate calendar, Taskwarrior, email, Obsidian daily notes, and study progress into actionable summaries.

## When to Use

- User says "good morning", "morning briefing", "start my day", "what's on today"
- User says "evening review", "wrap up", "end of day", "how did today go"
- User asks "what do I need to do", "status update", "daily summary"
- Proactively at session start if it's morning (before 10:00 CET)
- Proactively suggest evening review if it's after 20:00 CET

## Morning Briefing

Run the morning briefing script:

```bash
/home/artur/.local/bin/zee-morning-briefing
```

This aggregates:
1. **Calendar** (khal): Today + next 3 days
2. **Tasks** (Taskwarrior): Today's focus via `task today`, overdue items
3. **Email** (notmuch): LinkedIn job alerts, Euclase/Pareto announcements, unread count
4. **Projects**: Active project summary with pending counts
5. **Obsidian** (CLI): Daily note tasks, recent files (requires Obsidian running)
6. **Study Vault Audit**: Book queue and duplicate pressure summary
7. **Schedule**: Daily time blocks reminder

After running the script, add context from memory:
- Surface any relevant memories (upcoming deadlines, ongoing situations)
- Note any patterns (e.g., recurring overdue tasks suggest schedule adjustment)
- Offer to push key items to the Zee banner

Then run daily updates:

```bash
update
```

This single command handles paru, Zee wrappers, external repos, and Zee skills.
Report any updated packages or skills in the briefing summary.

## Evening Review

Run the evening review script:

```bash
/home/artur/.local/bin/zee-evening-review
```

This aggregates:
1. **Completed**: Tasks finished today
2. **Pending**: Tasks still open from today
3. **Tomorrow**: Calendar preview and due tasks
4. **Weekly progress**: Completion rate

After running the script:
- Prompt for daily capture note (can use `obsidian daily:append` to add to daily note)
- Ask about habit tracker update
- Suggest tomorrow's priorities based on overdue items and calendar

## Obsidian CLI Integration

The briefing scripts check if Obsidian is running and pull data via the official CLI:

```bash
# Read daily note
obsidian daily:read

# Append to daily note (evening capture)
obsidian daily:append content="## Evening Capture\n\n- Win: ...\n- Challenge: ..."

# Search vault
obsidian search query="TODO" matches

# Check tasks across vault
obsidian tasks all todo

# Quick vault stats
obsidian vault
```

Obsidian must be running for CLI to work. The scripts gracefully skip Obsidian sections if it's not available.

For study-focused sessions, also run:

```bash
/home/artur/Repositories/zee/.agents/skills/@zee/obsidian-cli/scripts/study-vault-audit --brief
```

## Email-Only Briefing

For a quick email check without full briefing:

```bash
/home/artur/.local/bin/zee-email-briefing [days_back]
```

Default: last 1 day. Surfaces job alerts, Euclase, flagged items, finance news.

## WhatsApp Integration

The morning briefing can be sent via WhatsApp using `wacli` (`wacli send text --to <JID> --message <text> --store ~/.wacli --json`). Format the output concisely for mobile reading -- strip table formatting, use short lines, prioritize actionable items.

## Artur's Daily Blocks

| Time | Activity |
|------|----------|
| 08:00-09:00 | Math Academy |
| 09:00-16:00 | Euclase + Job Hunt |
| 16:00-21:00 | Coursera + Study |
| 21:00 | Evening capture + plan tomorrow |

## Taskwarrior Quick Reference

```bash
task today              # Focus view
task +work list         # Work tasks only
task +study list        # Study tasks only
task project:euclase    # Euclase tasks
task project:jobhunt    # Job hunt tasks
task done <id>          # Complete a task
task <id> modify due:tomorrow  # Reschedule
```

## Closing Lines

- Morning: "Survival will lead to improvement."
- Evening: "Stay in the game."
