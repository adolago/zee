---
name: github-project-management
version: 1.0.0
description: Comprehensive GitHub project management with swarm-coordinated issue tracking, project board automation, and sprint planning
category: github
tags: [project-management, github, issues, sprints, johny]
author: Artur
requires:
  - gh-cli@^2.0.0
  - ruv-swarm@^1.0.11
  - claude-flow
---

# GitHub Project Management

Swarm-coordinated project management for issues, boards, and sprint planning.

## References

- `../github-shared-reference.md` - Common patterns, gh CLI commands, agent types

## Quick Start

```bash
# Initialize project board
npx claude-flow github project-init \
  --name "Sprint 1" \
  --columns "Backlog,Todo,In Progress,Review,Done"

# Auto-triage new issues
npx ruv-swarm github issue-triage \
  --analyze-content \
  --assign-labels \
  --estimate-effort
```

## Issue Management

### Create Issues
```bash
# Create with analysis
npx claude-flow github issue-create \
  --title "Bug: Login fails on mobile" \
  --body-file "issue-template.md" \
  --analyze-codebase \
  --suggest-assignee

# Bulk create from specification
npx claude-flow github issues-from-spec \
  --spec-file "features.md" \
  --create-subtasks \
  --link-to-epic
```

### Triage Issues
```bash
# Auto-triage open issues
npx ruv-swarm github issue-triage \
  --state open \
  --analyze-content \
  --assign-labels \
  --prioritize \
  --estimate-effort
```

### Issue Agents

| Agent | Purpose |
|-------|---------|
| `issue-analyst` | Content analysis and categorization |
| `effort-estimator` | Story point estimation |
| `assignee-matcher` | Match issues to team members |
| `priority-ranker` | Priority scoring |

## Sprint Planning

```bash
# Plan sprint from backlog
npx claude-flow github sprint-plan \
  --backlog-label "backlog" \
  --capacity 40 \
  --balance-workload \
  --create-board

# Sprint retrospective
npx claude-flow github sprint-retro \
  --sprint "Sprint 1" \
  --analyze-velocity \
  --identify-blockers \
  --generate-report
```

## Project Boards

```bash
# Create board
gh project create --title "Q1 Roadmap" --owner @me

# Sync issues to board
npx claude-flow github board-sync \
  --project "Q1 Roadmap" \
  --filter "label:q1" \
  --auto-move-on-status

# Board automation
npx claude-flow github board-automate \
  --project "Q1 Roadmap" \
  --rules-file "board-rules.json"
```

## Milestone Tracking

```bash
# Create milestone
gh api repos/{owner}/{repo}/milestones \
  --method POST \
  --field title="v2.0 Release" \
  --field due_on="2026-03-01T00:00:00Z"

# Track milestone progress
npx claude-flow github milestone-status \
  --milestone "v2.0 Release" \
  --show-blockers \
  --predict-completion
```

## Automation Rules

```json
{
  "rules": [
    {
      "trigger": "issue.opened",
      "conditions": ["label:bug"],
      "actions": ["add-to-project:Bugs", "assign:@on-call"]
    },
    {
      "trigger": "issue.closed",
      "conditions": ["project:Sprint*"],
      "actions": ["move-column:Done", "update-velocity"]
    }
  ]
}
```

## Reporting

```bash
# Velocity report
npx claude-flow github velocity-report \
  --sprints 5 \
  --format markdown

# Burndown chart
npx claude-flow github burndown \
  --sprint "Sprint 1" \
  --output chart.png
```

## Integration

- Use with **github-workflow-automation** for CI triggers
- Combine with **hooks-automation** for project hooks
- Works with **verification-quality** for quality tracking
