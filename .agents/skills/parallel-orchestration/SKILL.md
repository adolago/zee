---
name: parallel-orchestration
description: Lightweight parallel task orchestration using native Claude Code capabilities. Patterns for concurrent agent execution, background tasks, and coordinated workflows without external dependencies.
version: 1.0.0
author: Agent-Core
tags: [orchestration, parallel, agents, workflow, coordination]
---

# Parallel Orchestration

Lightweight patterns for parallel task execution using native Claude Code tools.

## Quick Start

### Parallel Exploration
```
Run 3 agents in parallel to explore different aspects:

Task(Explore): "Find all authentication code"
Task(Explore): "Find all database models"
Task(Explore): "Find all API routes"
```

### Parallel Development
```
Run implementation agents concurrently:

Task(coder): "Implement user model"
Task(coder): "Implement auth middleware"
Task(tester): "Write user model tests"
```

## Core Patterns

### Pattern 1: Fan-Out Research

When you need to gather information from multiple sources simultaneously:

```
[Single message - all run in parallel]
Task(Explore, "Find error handling patterns in src/")
Task(Explore, "Find logging implementations")
Task(Explore, "Find configuration loading code")
```

**Use when**: Starting a new task, onboarding to codebase, investigating an issue

### Pattern 2: Parallel Implementation

When implementing independent features:

```
[Single message - all run in parallel]
Task(coder, "Implement UserService class")
Task(coder, "Implement AuthService class")
Task(coder, "Implement validation utilities")
```

**Use when**: Features don't depend on each other, working on different files

### Pattern 3: Background + Foreground

Long task in background while doing quick work:

```
Task(coder, "Refactor entire auth module", run_in_background: true)
// Continue with other work immediately
// Check background task later with TaskOutput
```

**Use when**: Large refactoring, long-running analysis, builds

### Pattern 4: Research-Then-Implement

Sequential phases, parallel within phase:

```
// Phase 1: Parallel research
Task(Explore, "Find existing auth patterns")
Task(Explore, "Find test patterns")
// Wait for results...

// Phase 2: Parallel implementation (informed by research)
Task(coder, "Implement auth using discovered patterns")
Task(tester, "Write tests following project conventions")
```

### Pattern 5: Persona Delegation

Use specialized personas for their domains:

```
// Parallel persona work
Task(@zee, "Store research findings in memory")
Task(@stanley, "Analyze market data for AAPL")
Task(@johny, "Create learning plan for GraphQL")
```

## Available Agent Types

### Exploration Agents
| Type | Use For |
|------|---------|
| `Explore` | Codebase exploration, file finding, pattern discovery |
| `researcher` | Deep research, web search, documentation gathering |
| `analyzer` | Code analysis, pattern recognition, metrics |

### Implementation Agents
| Type | Use For |
|------|---------|
| `coder` | Writing code, implementing features |
| `tester` | Writing tests, test design |
| `debugger` | Bug investigation, fixing issues |
| `reviewer` | Code review, quality checks |

### Planning Agents
| Type | Use For |
|------|---------|
| `Plan` | Architecture decisions, implementation planning |
| `architect` | System design, component structure |

### Specialized Personas
| Persona | Domain |
|---------|--------|
| `@zee` | Memory, messaging, browser, calendar, life admin |
| `@stanley` | Market data, portfolio, SEC filings, trading |
| `@johny` | Learning, study sessions, knowledge graphs |

## Coordination via Memory

Use Zee's memory for agent coordination:

```typescript
// Agent 1 stores findings
zee:memory-store({
  content: "Auth uses JWT with RS256",
  domain: "research",
  topic: "auth"
})

// Agent 2 retrieves and builds on it
zee:memory-search({ query: "auth implementation" })
```

## Task Tracking

Use TodoWrite for complex workflows:

```typescript
TodoWrite([
  { id: "1", content: "Research auth patterns", status: "in_progress" },
  { id: "2", content: "Implement auth service", status: "pending" },
  { id: "3", content: "Write auth tests", status: "pending" },
  { id: "4", content: "Review and refactor", status: "pending" }
])
```

## Example Workflows

### Feature Development

```
1. [Parallel Research]
   Task(Explore): "Find similar features in codebase"
   Task(Explore): "Find relevant tests"
   Task(researcher): "Research best practices for X"

2. [Review findings, then Parallel Implementation]
   Task(coder): "Implement feature following patterns"
   Task(tester): "Write tests based on conventions"

3. [Sequential Review]
   Task(reviewer): "Review implementation quality"
```

### Bug Investigation

```
1. [Parallel Investigation]
   Task(Explore): "Find all usages of buggy function"
   Task(Explore): "Find related tests"
   Task(debugger): "Analyze error logs and stack traces"

2. [Fix based on findings]
   Task(coder): "Fix bug with minimal changes"
   Task(tester): "Add regression test"
```

### Codebase Onboarding

```
[All parallel - comprehensive codebase scan]
Task(Explore): "Map directory structure and key files"
Task(Explore): "Find entry points and main flows"
Task(Explore): "Find configuration and environment setup"
Task(Explore): "Find testing patterns and coverage"
Task(Explore): "Find deployment and CI/CD setup"
```

## Best Practices

1. **Batch parallel calls in single message** - All Task calls in one message run concurrently

2. **Use background for long tasks** - Don't block on refactoring or large analysis

3. **Store intermediate results** - Use `zee:memory-store` between phases

4. **Match agent to task** - Use Explore for finding, coder for writing, tester for tests

5. **Keep tasks focused** - Better to have 3 specific tasks than 1 vague task

6. **Check dependencies** - Don't parallelize tasks that depend on each other's output

## Limitations

- No automatic load balancing (manual task splitting)
- No built-in consensus (use memory for coordination)
- No automatic retry (handle in prompts)
- Background tasks need manual output checking

## See Also

- `@zee/SKILL.md` - Memory tools for coordination
- `sparc-methodology/SKILL.md` - Structured development phases
- `personas/SKILL.md` - Cross-persona capabilities
