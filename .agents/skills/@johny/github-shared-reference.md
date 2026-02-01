# GitHub Skills Shared Reference

Common patterns and configurations used across GitHub skills.

## Prerequisites

All GitHub skills require:
- `gh` (GitHub CLI) v2.0+
- `git`
- `claude-flow@alpha` or `ruv-swarm@^1.0.11`
- Node.js v16+

## Swarm Topologies

### Hierarchical
Best for structured workflows with clear dependencies.
```bash
--topology hierarchical
```

### Mesh
Best for distributed teams with peer-to-peer coordination.
```bash
--topology mesh
```

### Adaptive
Best for dynamic workloads that change over time.
```bash
--topology adaptive
```

## Common Swarm Patterns

### Initialize Swarm
```bash
npx ruv-swarm github <mode> \
  --topology <hierarchical|mesh|adaptive> \
  --shared-memory \
  --sync-strategy eventual
```

### Spawn Specialized Agents
```bash
npx claude-flow agent spawn \
  --type <agent-type> \
  --capabilities "<cap1>,<cap2>" \
  --memory-namespace "github/<context>"
```

### Memory Coordination
```javascript
mcp__claude-flow__memory_usage {
  action: "store",
  key: "github/<context>/<key>",
  namespace: "coordination",
  value: JSON.stringify({ /* data */ })
}
```

## gh CLI Patterns

### PR Operations
```bash
# Get PR details
gh pr view <number> --json files,additions,deletions,title,body

# Get PR diff
gh pr diff <number>

# Comment on PR
gh pr comment <number> --body "message"

# Create PR
gh pr create --title "title" --body "body"

# Merge PR
gh pr merge <number> --merge
```

### Issue Operations
```bash
# List issues
gh issue list --state open --label "bug"

# Create issue
gh issue create --title "title" --body "body"

# Close issue
gh issue close <number>
```

### Workflow Operations
```bash
# List workflows
gh workflow list

# Run workflow
gh workflow run <workflow> --field key=value

# View run
gh run view <run-id> --json jobs,conclusion
```

### Release Operations
```bash
# Create release
gh release create <tag> --title "title" --notes "notes"

# List releases
gh release list

# Download assets
gh release download <tag>
```

## Agent Types

### Code Review Agents
| Agent | Purpose |
|-------|---------|
| `security-reviewer` | Security vulnerabilities |
| `performance-reviewer` | Performance issues |
| `style-reviewer` | Style and conventions |
| `architecture-reviewer` | Design patterns |
| `accessibility-reviewer` | A11y compliance |

### Workflow Agents
| Agent | Purpose |
|-------|---------|
| `gh-coordinator` | Workflow orchestration |
| `pr-manager` | PR management |
| `release-manager` | Release automation |
| `issue-tracker` | Issue management |

### Project Agents
| Agent | Purpose |
|-------|---------|
| `project-coordinator` | Project board management |
| `sprint-manager` | Sprint planning |
| `milestone-tracker` | Milestone tracking |

## Quality Gates

### Standard Checks
```bash
npx ruv-swarm github quality-gate \
  --require-reviews 2 \
  --require-tests \
  --require-security-scan \
  --block-on-failure
```

### Truth Score Threshold
```bash
TRUTH_SCORE=$(npx claude-flow metrics score --format json | jq -r '.truth_score')
if (( $(echo "$TRUTH_SCORE < 0.95" | bc -l) )); then
  echo "Quality threshold not met"
  exit 1
fi
```

## Integration with Other Skills

All GitHub skills work with:
- **hooks-automation** - Pre/post hooks for GitHub operations
- **swarm-advanced** - Advanced swarm coordination
- **sparc-methodology** - SPARC workflow integration
- **verification-quality** - Truth-score verification
