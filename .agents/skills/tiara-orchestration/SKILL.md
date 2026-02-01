---
name: tiara-orchestration
description: Orchestration layer for the Personas system. Provides drone spawning, shared memory, conversation continuity, WezTerm integration, and execution patterns.
version: 1.0.0
author: Artur
tags: [orchestration, tiara, memory, continuity, spawning, wezterm]
---

# Tiara Orchestration

Tiara is the orchestration layer that powers all Personas (Zee, Stanley, Johny). It provides shared capabilities for coordinating work, persisting memory, and managing execution.

## Hold/Release Mode

**Check the mode indicator in the UI to determine your behavior:**

### HOLD Mode (Research & Planning)
When in HOLD mode, you are in **research and planning** mode:
- Do NOT edit files
- Do NOT run destructive commands
- Research, explore, analyze
- Use Oracle/Librarian/Explorer patterns
- Create plans and proposals
- Ask clarifying questions
- Read and understand code

**Behavior:** Act like you're preparing for implementation. Gather all context, understand the problem deeply, propose solutions, but don't execute changes.

### RELEASE Mode (Implementation)
When in RELEASE mode, you are in **implementation** mode:
- Edit files
- Run commands
- Execute plans
- Make changes
- Complete tasks

**Behavior:** Execute with confidence. You've done the research (in HOLD), now implement.

### Mode Detection
Look for the mode indicator in the UI header. If you're unsure:
- Ask: "Am I in HOLD or RELEASE mode?"
- Default to HOLD behavior if uncertain

## Daemon Runtime

Start the personas daemon when you want a shared runtime for all personas and editor LSP:

```bash
npx tsx scripts/personas-daemon.ts start --lsp-port 7777
```

Query or control the daemon via local IPC (Unix socket):

```bash
npx tsx scripts/personas-daemon.ts status
npx tsx scripts/personas-daemon.ts stop
npx tsx scripts/personas-daemon.ts restart
```

Spawn or submit work to the tiara:

```bash
npx tsx scripts/personas-daemon.ts spawn --persona zee --task "Research X" --prompt "Find sources"
npx tsx scripts/personas-daemon.ts submit --persona stanley --description "Analyze NVDA" --prompt "Run fundamentals"
```

## Drone Spawning

You can spawn background workers (drones) that maintain your persona identity:

```
To spawn a drone:
1. Identify a task that would benefit from background execution
2. Formulate a clear prompt for the drone
3. Use the Task tool with your persona's identity
4. The drone will work independently and report back
```

**When to spawn:**
- Research tasks that take time
- Parallel analysis work
- Background monitoring
- Tasks that don't need immediate user interaction

**Example:**
```
I need to research X while we continue discussing Y.
Let me spawn a drone to handle the research in the background.
```

### Drone Communication

Drones inherit your identity but work independently:

```
Drone receives:
- Your persona traits
- Current plan/objectives
- Relevant context from memory
- The specific task prompt

Drone returns:
- Task results
- Key findings to remember
- Suggested updates to shared state
```

## Shared Memory (Qdrant)

All Personas share a semantic memory system:

- **Store facts** - Important information is saved for later retrieval
- **Search memories** - Find relevant context from past conversations
- **Cross-persona access** - What one persona learns, others can recall

**Memory categories:**
- `conversation` - Chat history summaries
- `fact` - Key facts and decisions
- `preference` - User preferences
- `task` - Task outcomes and learnings
- `context` - Contextual information

### Cross-Persona Memory

One persona can reference another's findings:
```
"Stanley's market analysis from earlier indicated..."
"Johny's learning notes on this topic suggest..."
"Zee's previous research found..."
```

## Conversation Continuity

Your conversation persists across session boundaries:

**Automatically preserved:**
- Summary of recent discussion
- Key facts extracted from conversation
- Current plan and objectives
- Session chain (previous session IDs)

**Before compacting:**
- Review what needs to be remembered
- Ensure key decisions are captured
- Update the plan if needed

**After restoring:**
- Check restored context for relevance
- Acknowledge continuity to user
- Continue from where you left off

## WezTerm Integration

When running in WezTerm, you have visual orchestration:

- **Pane management** - Each drone gets its own pane
- **Status display** - See all active workers
- **Live output** - Watch drones work in real-time

## State Management

### Current Plan
Always maintain awareness of the current plan:
```
The plan should include:
- What we're trying to accomplish
- Major milestones or phases
- Current progress
```

### Objectives
Track active goals:
```
Objectives are specific, actionable items:
- Should be completable
- Progress should be measurable
- Mark as done when achieved
```

### Key Facts
Important information to remember:
```
Key facts include:
- User preferences
- Important decisions made
- Critical context
- Technical details
```

---

## Advanced Execution Patterns

### Ralph Loop (Continuous Execution)

Run until task completion - the "discipline agent" pattern:

```
To start a Ralph Loop:
1. Define a clear task with measurable completion criteria
2. Work continuously, making meaningful progress each iteration
3. When FULLY complete, output: <promise>DONE</promise>
4. Loop auto-continues if promise not given
```

**When to use Ralph Loop:**
- Large refactoring tasks
- Multi-file changes
- Complex implementations requiring persistence
- Tasks that benefit from "just keep going until done"

**Exit conditions:**
1. Output `<promise>DONE</promise>` when complete
2. Max iterations reached (default: 100)
3. User cancels

### Think Mode (Enhanced Reasoning)

For complex decisions, use extended reasoning:

```
When facing:
- Architectural decisions
- Trade-off analysis
- Multi-step planning
- Debugging complex issues

Activate think mode:
- Break problem into components
- Consider multiple approaches
- Evaluate trade-offs explicitly
- Document reasoning chain
```

### Context Recovery

Handle context window limits gracefully:

```
Before hitting limits:
1. Preserve critical context (current task, key decisions)
2. Store to shared memory (Qdrant)
3. Create checkpoint summary

After recovery:
1. Restore context from memory
2. Resume from checkpoint
3. Continue with reduced history
```

---

## Agent Delegation Table

Delegate to specialized agents based on task type:

| Task Type | Delegate To | Why |
|-----------|------------|-----|
| Deep codebase research | **Oracle** | Comprehensive exploration |
| Documentation lookup | **Librarian** | API/docs knowledge |
| Codebase structure | **Explorer** | Fast pattern search |
| UI/UX implementation | **Frontend Engineer** | Visual expertise |
| Chart/screenshot analysis | **Multimodal Looker** | Visual understanding |

---

## Execution Protocols

These protocols are available to all personas. Apply the domain-specific variant as needed.

### Oracle Protocol (Deep Research)

Comprehensive understanding of codebases, topics, or domains:

```
Oracle Protocol:
1. Spawn background research drones for parallel exploration
2. Search broadly first, then narrow down
3. Build mental model of architecture/domain
4. Cross-reference multiple sources
5. Synthesize findings into actionable knowledge
```

**Use Oracle for:**
- Understanding unfamiliar codebases
- Researching library APIs and patterns
- Deep company/industry research (Stanley)
- Building prerequisite knowledge (Johny)

**Finance variant (Stanley):**
- Start with macro context (economic environment, sector trends)
- Drill down to company specifics
- Cross-reference SEC filings, news, technicals
- Synthesize into actionable thesis

### Librarian Protocol (Documentation Lookup)

Fast, focused documentation retrieval:

```
Librarian Protocol:
1. Identify the exact API/function needed
2. Go directly to authoritative source
3. Extract relevant signature and examples
4. Return concise, actionable information
```

**Use Librarian for:**
- API documentation lookups
- Quick reference checks
- Parameter/return type verification
- Finding canonical examples

### Explorer Protocol (Codebase Navigation)

Rapid structural understanding:

```
Explorer Protocol:
1. Glob for file patterns
2. Grep for key identifiers
3. Build directory map
4. Identify entry points and flows
```

**Use Explorer for:**
- "Where is X defined?"
- "What files touch Y?"
- "How is Z structured?"

### Multimodal Protocol (Visual Analysis)

Analyze screenshots, charts, and visual content:

```
Multimodal Protocol:
1. Request/receive visual content
2. Analyze structure, patterns, key information
3. Extract actionable data (dates, names, values)
4. Integrate with domain context
```

**Use Multimodal for:**
- Message screenshots (Zee) - extract dates, names, actions
- Chart analysis (Stanley) - price patterns, volume, indicators
- Receipt/invoice processing (Zee)
- Trading platform screenshots (Stanley)
- UI navigation assistance

### Interactive Bash Protocol (Background Processes)

Manage persistent terminal sessions:

```
Interactive Bash Protocol:
1. Spawn persistent terminal sessions (via tmux/WezTerm)
2. Run long-running tasks in background
3. Check on status periodically
4. Collect output when complete
```

**Use Interactive Bash for:**
- Running scripts that take time
- Monitoring logs
- Parallel task execution
- Background data syncing

### Frontend Protocol (UI Assistance)

When visual interfaces are needed:

```
Frontend Protocol:
1. Identify UI requirement
2. Delegate to Frontend Engineer agent
3. Review proposed design
4. Iterate on feedback
```

**Use Frontend for:**
- Personal dashboards
- Trading dashboards
- Notification displays
- Quick utilities

---

## Tool Selection Matrix

| Need | Tool | Why |
|------|------|-----|
| Find definition | LSP go-to-definition | Precise, follows imports |
| Find all usages | LSP references | Complete, accurate |
| Structural search | AST-grep | Pattern-based code search |
| Text search | Grep | Fast, broad |
| File patterns | Glob | Find by name/path |
| Rename symbol | LSP rename | Safe, project-wide |
| Visual analysis | Multimodal Looker | Image understanding |
| Background task | Interactive Bash | Persistent execution |

---

## Hard Blocks (Never Do)

- Never continue without completing current file edit
- Never skip tests for "later"
- Never assume code works without verification
- Never leave TODO comments in production code

## Anti-Patterns to Avoid

- **Token waste**: Repeating yourself, excessive explanations
- **Context flooding**: Reading entire files when you need a function
- **Shallow completion**: Marking done before actually done
- **Blind execution**: Running commands without understanding

---

## Best Practices

1. **Spawn strategically** - Don't spawn for trivial tasks
2. **Preserve context** - Actively maintain continuity
3. **Share learnings** - Store important findings in memory
4. **Check state** - Be aware of what drones are doing
5. **Clean up** - Kill completed/stuck workers

## Technical Reference

The Tiara system is implemented in `src/personas/`:

- `types.ts` - Type definitions
- `persona.ts` - Persona configurations
- `tiara.ts` - Main coordinator
- `memory-bridge.ts` - Qdrant integration
- `wezterm.ts` - Terminal integration
- `continuity.ts` - Session persistence

## Environment Variables

- `AGENT_CORE_IPC_SOCKET` - Override IPC socket path (default: `~/.zee/agent-core/daemon.sock`)
