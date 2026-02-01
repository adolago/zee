---
name: swarm
description: Parallel worker coordination with WezTerm visualization, shared memory, and SPARC phases.
version: 2.0.0
author: Artur
tags: [orchestration, swarm, memory, wezterm, sparc, consensus]
---

# Swarm

The swarm module (`src/swarm/`) provides Claude-Flow-level parallelism for all Personas.

## Core Capabilities

### Queen Coordinator
Spawns N workers in parallel with real-time output streaming:

```typescript
import { Queen, runSwarm } from "./src/swarm";

// Simple parallel execution
const result = await runSwarm([
  { name: "Auth", prompt: "Audit the auth system", persona: "zee" },
  { name: "API", prompt: "Review API endpoints", persona: "zee" },
  { name: "Tests", prompt: "Check test coverage", persona: "johny" },
]);

// Full control with Queen
const queen = new Queen({ panes: true, maxWorkers: 6 });
queen.on("worker:output", (msg) => console.log(msg.data));
await queen.spawn(workerConfigs);
```

### WezTerm Panes
Each worker gets its own terminal pane for visual monitoring:

```typescript
import { createWorkerPanes, splitPane } from "./src/swarm";

// Split pane for a single worker
const pane = await splitPane({ title: "Research", cwd: "/project" });

// Create grid of panes
const panes = await createWorkerPanes(4);
```

### Shared Memory
Workers share state via Memory MCP:
- Write findings to memory during work
- Other workers can query memory
- Queen aggregates results

## Patterns

### Fan-Out
Run same analysis on multiple contexts:

```typescript
import { fanOut } from "./src/swarm";

const result = await fanOut(
  "Analyze this file for security issues",
  [file1, file2, file3, file4]
);
```

### Research
Multiple parallel researchers:

```typescript
import { research } from "./src/swarm";

const result = await research([
  "What are the best practices for JWT auth?",
  "How do other repos handle rate limiting?",
  "What security headers should we add?",
]);
```

## SPARC Methodology (Johny Only)

When Johny is developing code, use SPARC phases:

```typescript
import { runSparcPipeline, runSparcParallel } from "./src/swarm";

// Sequential pipeline (safer)
const results = await runSparcPipeline({
  description: "Add user authentication",
  files: ["src/auth/", "src/routes/"],
});

// Parallel early phases (faster)
const results = await runSparcParallel({
  description: "Refactor database layer",
});
```

### SPARC Phases

1. **Specification** - Define requirements clearly
2. **Pseudocode** - Outline logic before coding
3. **Architecture** - Design component structure
4. **Refinement** - Iterate on implementation (TDD)
5. **Completion** - Test and document

### When to Use SPARC

- New feature development
- Major refactoring
- Complex bug fixes
- System design tasks

### When NOT to Use SPARC

- Simple fixes
- Documentation updates
- Config changes
- Quick queries

## Hold/Release Mode

### HOLD Mode (Research & Planning)
- Do NOT edit files
- Do NOT run destructive commands
- Research, explore, analyze
- Create plans and proposals
- Use Oracle for complex reasoning

### RELEASE Mode (Implementation)
- Edit files
- Run commands
- Execute plans
- Complete tasks

## Event-Driven Coordination

The Queen emits events you can subscribe to:

```typescript
const queen = new Queen();

queen.on("start", ({ swarmId, workerCount }) => {
  console.log(`Swarm ${swarmId} started with ${workerCount} workers`);
});

queen.on("worker:output", (msg) => {
  console.log(`[${msg.workerId}] ${msg.data}`);
});

queen.on("worker:complete", (msg) => {
  console.log(`Worker ${msg.workerId} completed`);
});

queen.on("worker:error", (msg) => {
  console.error(`Worker ${msg.workerId} failed: ${msg.data}`);
});

queen.on("complete", (result) => {
  console.log(`Swarm completed in ${result.duration}ms`);
});
```

## Abort/Redirect

```typescript
// Abort all workers
await queen.abortAll();

// Abort specific worker
await queen.abort("worker-2");

// Check if done
if (queen.isDone()) {
  const result = queen.getResult();
}
```

## Implementation

The swarm module lives in `src/swarm/`:

```
src/swarm/
├── index.ts    # Exports
├── types.ts    # Type definitions
├── queen.ts    # Coordinator
├── worker.ts   # Persistent worker
├── panes.ts    # WezTerm integration
└── sparc.ts    # SPARC methodology (Johny)
```

## Migration from Tiara

The `packages/tiara/` package has been replaced by `src/swarm/`:

| Tiara | Swarm |
|-------|-------|
| `tiara sparc run` | `runSparcPipeline()` |
| `tiara hive-mind spawn` | `queen.spawn()` |
| `npx tiara hooks` | Built into worker lifecycle |
| Claude-Flow MCP | Direct function calls |

The swarm module is ~300 lines vs Tiara's ~30,000 lines.
