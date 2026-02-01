---
name: github-code-review
version: 1.0.0
description: Comprehensive GitHub code review with AI-powered swarm coordination
category: github
tags: [code-review, github, swarm, pr-management, johny]
author: Artur
requires:
  - github-cli
  - ruv-swarm
  - claude-flow
---

# GitHub Code Review Skill

AI-powered code review using specialized review agents for comprehensive, intelligent analysis.

## References

- `../github-shared-reference.md` - Common patterns, gh CLI commands, agent types

## Quick Start

```bash
# Initialize review swarm for PR
gh pr view 123 --json files,diff | npx ruv-swarm github review-init --pr 123

# Post review status
gh pr comment 123 --body "Multi-agent code review initiated"
```

### Complete Review Workflow

```bash
# Get PR context with gh CLI
PR_DATA=$(gh pr view 123 --json files,additions,deletions,title,body)
PR_DIFF=$(gh pr diff 123)

# Initialize comprehensive review
npx ruv-swarm github review-init \
  --pr 123 \
  --pr-data "$PR_DATA" \
  --diff "$PR_DIFF" \
  --agents "security,performance,style,architecture,accessibility" \
  --depth comprehensive
```

## Review Agents

| Agent | Focus Area |
|-------|------------|
| `security-reviewer` | Vulnerabilities, injection, auth issues |
| `performance-reviewer` | N+1 queries, memory leaks, complexity |
| `architecture-reviewer` | Design patterns, coupling, SOLID |
| `style-reviewer` | Naming, formatting, conventions |
| `accessibility-reviewer` | WCAG compliance, keyboard nav, ARIA |

### Agent Configuration

```bash
# Security-focused review
npx ruv-swarm github review \
  --pr 123 \
  --agents "security" \
  --depth deep \
  --check-owasp \
  --scan-dependencies

# Performance-focused review
npx ruv-swarm github review \
  --pr 123 \
  --agents "performance" \
  --analyze-complexity \
  --detect-bottlenecks
```

## Review Modes

### Quick Review
For small PRs (<100 lines):
```bash
npx ruv-swarm github review --pr 123 --mode quick
```

### Standard Review
For medium PRs (100-500 lines):
```bash
npx ruv-swarm github review --pr 123 --mode standard
```

### Comprehensive Review
For large PRs or critical changes:
```bash
npx ruv-swarm github review \
  --pr 123 \
  --mode comprehensive \
  --agents "security,performance,style,architecture" \
  --generate-report
```

## Quality Gates

```bash
# Enforce quality gates
npx ruv-swarm github quality-gate \
  --pr 123 \
  --require-reviews 2 \
  --require-all-agents \
  --block-on-critical
```

### Truth Score Verification
```bash
SCORE=$(npx claude-flow metrics score --pr 123 --format json | jq -r '.truth_score')
if (( $(echo "$SCORE < 0.95" | bc -l) )); then
  gh pr comment 123 --body "Quality threshold not met: $SCORE"
  exit 1
fi
```

## Output Formats

```bash
# Inline comments
npx ruv-swarm github review --pr 123 --output inline

# Summary comment
npx ruv-swarm github review --pr 123 --output summary

# Markdown report
npx ruv-swarm github review --pr 123 --output markdown --file review.md
```

## Integration

- Use with **hooks-automation** for automated triggers
- Combine with **verification-quality** for truth-score checks
- Works with **sparc-methodology** for structured development
