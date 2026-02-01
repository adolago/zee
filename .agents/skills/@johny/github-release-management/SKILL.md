---
name: github-release-management
version: 1.0.0
description: Comprehensive GitHub release orchestration with AI swarm coordination for automated versioning, testing, deployment, and rollback management
category: github
tags: [release, deployment, versioning, rollback, johny]
author: Artur
requires:
  - gh-cli@^2.0.0
  - ruv-swarm@^1.0.11
  - claude-flow
---

# GitHub Release Management

AI-orchestrated release management with automated versioning, testing, and deployment.

## References

- `../github-shared-reference.md` - Common patterns, gh CLI commands, agent types

## Quick Start

```bash
# Create release with analysis
npx ruv-swarm github release-create \
  --analyze-commits \
  --generate-changelog \
  --version auto

# Full release workflow
npx claude-flow github release \
  --from-branch "develop" \
  --to-branch "main" \
  --version-bump "minor" \
  --run-tests \
  --deploy-staging
```

## Release Workflow

### Version Bump
```bash
# Auto-detect version bump from commits
npx claude-flow github version-bump \
  --analyze-commits \
  --conventional-commits \
  --update-package-json

# Manual version
npx claude-flow github version-bump \
  --version "2.1.0" \
  --update-changelog
```

### Create Release
```bash
# Basic release
gh release create v2.1.0 \
  --title "v2.1.0" \
  --notes-file CHANGELOG.md

# With assets
gh release create v2.1.0 \
  --title "v2.1.0" \
  --notes-file CHANGELOG.md \
  ./dist/*.tar.gz ./dist/*.zip
```

### Changelog Generation
```bash
# Generate from commits
npx claude-flow github changelog \
  --from "v2.0.0" \
  --to "HEAD" \
  --format conventional \
  --group-by-type

# With AI enhancement
npx ruv-swarm github changelog \
  --from "v2.0.0" \
  --enhance-descriptions \
  --add-breaking-changes-section
```

## Release Agents

| Agent | Purpose |
|-------|---------|
| `version-analyzer` | Analyze commits for version bump |
| `changelog-generator` | Generate release notes |
| `test-coordinator` | Coordinate pre-release testing |
| `deploy-orchestrator` | Manage deployment stages |
| `rollback-manager` | Handle rollback scenarios |

## Deployment Stages

```bash
# Deploy to staging
npx claude-flow github deploy \
  --version "v2.1.0" \
  --environment staging \
  --wait-for-tests

# Promote to production
npx claude-flow github deploy \
  --version "v2.1.0" \
  --environment production \
  --require-approval \
  --canary-percentage 10
```

## Rollback

```bash
# Quick rollback
npx claude-flow github rollback \
  --to-version "v2.0.0" \
  --environment production

# Rollback with analysis
npx ruv-swarm github rollback \
  --analyze-failure \
  --to-version "v2.0.0" \
  --notify-team \
  --create-incident
```

## Pre-Release Checks

```bash
# Quality gate
npx claude-flow github release-gate \
  --require-passing-tests \
  --require-security-scan \
  --require-approval \
  --min-coverage 80
```

## Multi-Repo Releases

```bash
# Coordinated release across repos
npx claude-flow github release-multi \
  --repos "org/api,org/ui,org/shared" \
  --version-strategy aligned \
  --create-umbrella-release
```

## Hotfix Workflow

```bash
# Create hotfix
npx claude-flow github hotfix \
  --from-release "v2.1.0" \
  --fix-branch "hotfix/security-patch" \
  --fast-track \
  --notify-on-complete
```

## Release Notes Template

```markdown
## What's Changed

### Features
- Feature description (#123)

### Bug Fixes
- Bug fix description (#124)

### Breaking Changes
- Breaking change description

**Full Changelog**: https://github.com/org/repo/compare/v2.0.0...v2.1.0
```

## Integration

- Use with **github-workflow-automation** for CI/CD
- Combine with **github-multi-repo** for coordinated releases
- Works with **hooks-automation** for release hooks
