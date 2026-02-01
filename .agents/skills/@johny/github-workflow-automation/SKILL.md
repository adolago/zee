---
name: github-workflow-automation
version: 1.0.0
category: github
description: Advanced GitHub Actions workflow automation with AI swarm coordination, intelligent CI/CD pipelines, and comprehensive repository management
tags: [github-actions, ci-cd, workflow-automation, deployment, johny]
author: Artur
requires:
  - gh (GitHub CLI)
  - git
  - claude-flow@alpha
---

# GitHub Workflow Automation

Comprehensive GitHub Actions automation with AI swarm coordination for intelligent CI/CD pipelines.

## References

- `../github-shared-reference.md` - Common patterns, gh CLI commands, agent types

## Quick Start

```bash
# Generate optimal workflow
npx ruv-swarm actions generate-workflow \
  --analyze-codebase \
  --detect-languages \
  --create-optimal-pipeline

# Optimize existing workflow
npx ruv-swarm actions optimize \
  --workflow ".github/workflows/ci.yml" \
  --suggest-parallelization

# Analyze failed runs
gh run view <run-id> --json jobs,conclusion | \
  npx ruv-swarm actions analyze-failure \
    --suggest-fixes
```

## Workflow Generation

```bash
# Basic CI workflow
npx claude-flow github workflow-generate \
  --type ci \
  --languages "typescript,python" \
  --include-tests \
  --include-lint

# Full CI/CD workflow
npx claude-flow github workflow-generate \
  --type ci-cd \
  --environments "staging,production" \
  --require-approval production \
  --include-security-scan
```

## GitHub Modes

| Mode | Purpose |
|------|---------|
| `gh-coordinator` | Workflow orchestration |
| `pr-manager` | PR automation |
| `issue-tracker` | Issue management |
| `release-manager` | Release automation |

### Usage
```bash
npx claude-flow@alpha github gh-coordinator \
  "Coordinate multi-repo release across 5 repositories"
```

## Workflow Optimization

```bash
# Analyze and optimize
npx ruv-swarm actions optimize \
  --workflow ".github/workflows/ci.yml" \
  --analyze-timing \
  --suggest-caching \
  --parallelize-jobs

# Auto-apply optimizations
npx ruv-swarm actions optimize \
  --workflow ".github/workflows/ci.yml" \
  --apply-changes \
  --create-pr
```

## Failure Analysis

```bash
# Analyze single failure
gh run view <run-id> --json jobs,conclusion | \
  npx ruv-swarm actions analyze-failure

# Pattern analysis across runs
npx ruv-swarm actions failure-patterns \
  --last-runs 50 \
  --identify-flaky \
  --suggest-fixes
```

## Self-Healing Workflows

```yaml
# Auto-retry configuration
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]

jobs:
  auto-retry:
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest
    steps:
      - name: Analyze and retry
        run: |
          npx ruv-swarm actions analyze-and-retry \
            --run-id ${{ github.event.workflow_run.id }} \
            --max-retries 2
```

## Security Scanning

```bash
# Add security to workflow
npx claude-flow github workflow-add-security \
  --workflow ".github/workflows/ci.yml" \
  --include-dependabot \
  --include-codeql \
  --include-secret-scan
```

## Matrix Builds

```bash
# Generate matrix strategy
npx claude-flow github matrix-generate \
  --platforms "ubuntu-latest,windows-latest" \
  --node-versions "18,20,22" \
  --optimize-order
```

## Caching Strategies

```bash
# Analyze and add caching
npx ruv-swarm actions add-caching \
  --workflow ".github/workflows/ci.yml" \
  --detect-package-managers \
  --add-build-cache
```

## Common Workflow Patterns

### Pull Request CI
```yaml
on:
  pull_request:
    branches: [main, develop]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup and Test
        run: npm ci && npm test
```

### Release Workflow
```yaml
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build and Release
        run: npm run build
      - name: Create Release
        run: gh release create ${{ github.ref_name }}
```

## Integration

- Use with **github-release-management** for release automation
- Combine with **hooks-automation** for workflow hooks
- Works with **verification-quality** for quality gates
