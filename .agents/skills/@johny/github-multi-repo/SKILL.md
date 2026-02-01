---
name: github-multi-repo
version: 1.0.0
description: Multi-repository coordination, synchronization, and architecture management with AI swarm orchestration
category: github-integration
tags: [multi-repo, synchronization, architecture, coordination, johny]
author: Artur
requires:
  - ruv-swarm@^1.0.11
  - gh-cli@^2.0.0
---

# GitHub Multi-Repository Coordination

Advanced multi-repository coordination with swarm intelligence for cross-project collaboration.

## References

- `../github-shared-reference.md` - Common patterns, gh CLI commands, agent types

## Quick Start

### Initialize Multi-Repo Coordination

```bash
# Basic swarm initialization
npx claude-flow skill run github-multi-repo init \
  --repos "org/frontend,org/backend,org/shared" \
  --topology hierarchical

# Advanced with synchronization
npx claude-flow skill run github-multi-repo init \
  --repos "org/frontend,org/backend,org/shared" \
  --topology mesh \
  --shared-memory \
  --sync-strategy eventual
```

### Synchronize Packages

```bash
# Synchronize versions and dependencies
npx claude-flow skill run github-multi-repo sync \
  --packages "claude-code-flow,ruv-swarm" \
  --align-versions \
  --update-docs
```

### Optimize Architecture

```bash
# Analyze and optimize structure
npx claude-flow skill run github-multi-repo optimize \
  --analyze-structure \
  --suggest-improvements \
  --create-templates
```

## Core Capabilities

| Capability | Description |
|------------|-------------|
| **Swarm Coordination** | Cross-repo AI swarm orchestration |
| **Package Sync** | Dependency resolution and version alignment |
| **Architecture Mgmt** | Structure optimization and templates |
| **Integration Testing** | Cross-package testing coordination |

## Multi-Repo Topologies

### Hierarchical
```bash
npx claude-flow multi-repo \
  --repos "org/core,org/api,org/ui" \
  --topology hierarchical \
  --primary-repo "org/core"
```

### Mesh
```bash
npx claude-flow multi-repo \
  --repos "org/service-a,org/service-b,org/service-c" \
  --topology mesh \
  --sync-strategy eventual
```

## Version Alignment

```bash
# Align major versions across repos
npx claude-flow multi-repo sync-versions \
  --pattern "^2\\." \
  --update-lockfiles \
  --create-prs

# Sync shared dependencies
npx claude-flow multi-repo sync-deps \
  --shared-packages "lodash,axios,react" \
  --strategy highest
```

## Template Management

```bash
# Generate repo from template
npx claude-flow multi-repo template apply \
  --template "org/template-microservice" \
  --new-repo "org/new-service" \
  --variables "name=new-service,port=3000"

# Propagate template updates
npx claude-flow multi-repo template sync \
  --template "org/template-microservice" \
  --targets "org/service-*" \
  --create-prs
```

## Cross-Repo PRs

```bash
# Create coordinated PRs across repos
npx claude-flow multi-repo pr-create \
  --repos "org/frontend,org/backend" \
  --title "Feature: User auth" \
  --branch "feature/user-auth" \
  --link-prs
```

## Integration

- Works with **github-workflow-automation** for CI/CD
- Combine with **github-release-management** for coordinated releases
- Use **hooks-automation** for cross-repo triggers
