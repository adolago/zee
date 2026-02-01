# Hive Mind Context File Tracking System

## Overview
Using 50 hives to track and classify all `.md` files that provide context to models in the agent-core codebase.

---

## HIVE CLASSIFICATION MATRIX

### CORE PERSONA HIVES (Hives 1-6)

| Hive | Category | Files | Purpose |
|------|----------|-------|---------|
| **Hive 1** | Zee Persona Core | 5 | Personal assistant identity |
| **Hive 2** | Stanley Persona Core | 3 | Investing assistant identity |
| **Hive 3** | Johny Persona Core | 3 | Learning assistant identity |
| **Hive 4** | Persona Shared Layer | 1 | Cross-persona orchestration |
| **Hive 5** | Agent Definitions (Root) | 4 | Root-level AGENTS.md files |
| **Hive 6** | Agent Commands | 12 | Built-in command documentation |

### SKILL HIVES - SHARED (Hives 7-20)

| Hive | Category | Files | Purpose |
|------|----------|-------|---------|
| **Hive 7** | AgentDB Skills | 5 | Vector database capabilities |
| **Hive 8** | Flow Nexus Skills | 3 | Platform/swarm/neural skills |
| **Hive 9** | Swarm/Hive Skills | 4 | Orchestration and coordination |
| **Hive 10** | Memory/Reasoning Skills | 4 | ReasoningBank intelligence |
| **Hive 11** | Media/Content Skills | 5 | TTS, video, images, PDF |
| **Hive 12** | Search/Research Skills | 3 | Web search, summarization |
| **Hive 13** | Utility Skills | 5 | Bitwarden, Obsidian, blogwatcher |
| **Hive 14** | Advanced Tech Skills | 3 | Jujutsu, stream-chain, agentic |
| **Hive 15** | RESERVED | - | Future expansion |
| **Hive 16** | RESERVED | - | Future expansion |
| **Hive 17** | RESERVED | - | Future expansion |
| **Hive 18** | RESERVED | - | Future expansion |
| **Hive 19** | RESERVED | - | Future expansion |
| **Hive 20** | RESERVED | - | Future expansion |

### SKILL HIVES - PERSONA-SPECIFIC (Hives 21-35)

| Hive | Category | Files | Purpose |
|------|----------|-------|---------|
| **Hive 21** | @Johny Core Skills | 17 | Johny-specific capabilities |
| **Hive 22** | @Johny GitHub Skills | 6 | GitHub integration skills |
| **Hive 23** | @Stanley Financial | 7 | Stanley investing skills |
| **Hive 24** | @Zee Core Skills | 14 | Zee personal assistant skills |
| **Hive 25** | @Zee PIM Classic | 8 | Email/calendar/contact configs |
| **Hive 26** | Zee Gateway Skills | 41 | Zee messaging gateway skills |
| **Hive 27** | Zee Extension Skills | 18 | Extensions (prose, voice, etc) |
| **Hive 28** | Tiara Skills | 11 | Orchestration skills |
| **Hive 29** | RESERVED | - | Future persona skills |
| **Hive 30** | RESERVED | - | Future persona skills |
| **Hive 31** | RESERVED | - | Future persona skills |
| **Hive 32** | RESERVED | - | Future persona skills |
| **Hive 33** | RESERVED | - | Future persona skills |
| **Hive 34** | RESERVED | - | Future persona skills |
| **Hive 35** | RESERVED | - | Future persona skills |

### ARCHITECTURE & REFERENCE HIVES (Hives 36-42)

| Hive | Category | Files | Purpose |
|------|----------|-------|---------|
| **Hive 36** | Root Documentation | 8 | Main project docs (AGENTS, README, etc) |
| **Hive 37** | Architecture Docs | 8 | ADRs, system design |
| **Hive 38** | Reference Templates | 16 | CLAUDE.md templates |
| **Hive 39** | Zee Docs - Core | 30 | Main documentation |
| **Hive 40** | Zee Docs - Gateway | 35 | Gateway-specific docs |
| **Hive 41** | Zee Docs - CLI | 35 | CLI command docs |
| **Hive 42** | Zee Docs - Concepts | 25 | Conceptual documentation |

### TIARA ORCHESTRATION HIVES (Hives 43-48)

| Hive | Category | Files | Purpose |
|------|----------|-------|---------|
| **Hive 43** | Tiara CLAUDE.md | 1 | Main orchestration instructions |
| **Hive 44** | Tiara Agents | 50 | Specialized agent definitions |
| **Hive 45** | Tiara Commands | 40 | Slash command implementations |
| **Hive 46** | Tiara Skills | 15 | Tiara-specific skills |
| **Hive 47** | Tiara Documentation | 60 | Architecture, guides, reports |
| **Hive 48** | Tiara Templates | 20 | Init templates, hooks |

### SPECIALIZED HIVES (Hives 49-50)

| Hive | Category | Files | Purpose |
|------|----------|-------|---------|
| **Hive 49** | Hooks & Automation | 15 | Bundled and custom hooks |
| **Hive 50** | Test Fixtures & Misc | 10 | Test configs, misc docs |

---

## DETAILED FILE LISTINGS BY HIVE

### HIVE 1: Zee Persona Core
```
.agents/skills/zee/SKILL.md                    [Primary Zee definition]
.agents/skills/zee/examples.md                 [Usage examples]
.agents/skills/zee/tools-reference.md          [Tool reference]
.agents/skills/zee/writer/SKILL.md             [Writer skill]
.agent-core/agent/zee.md                       [Runtime agent def]
```

### HIVE 2: Stanley Persona Core
```
.agents/skills/stanley/SKILL.md                [Primary Stanley definition]
.agent-core/agent/stanley.md                   [Runtime agent def]
packages/personas/stanley/README.md            [Package README]
```

### HIVE 3: Johny Persona Core
```
.agents/skills/johny/SKILL.md                  [Primary Johny definition]
.agent-core/agent/johny.md                     [Runtime agent def]
```

### HIVE 4: Persona Shared Layer
```
.agents/skills/personas/SKILL.md               [Shared orchestration]
.agents/skills/agents-menu/SKILL.md            [Quick reference]
.agents/skills/tiara-orchestration/SKILL.md    [Orchestration layer]
```

### HIVE 5: Agent Definitions (Root)
```
AGENTS.md                                      [Root AGENTS - canonical]
packages/agent-core/AGENTS.md                  [Package AGENTS]
packages/personas/zee/AGENTS.md                [Zee package AGENTS]
CLAUDE.md                                      [Symlink to AGENTS]
```

### HIVE 6: Agent Commands
```
.agent-core/command/ai-deps.md
.agent-core/command/commit.md
.agent-core/command/e.md
.agent-core/command/help.md
.agent-core/command/issues.md
.agent-core/command/mode.md
.agent-core/command/q.md
.agent-core/command/rmslop.md
.agent-core/command/spellcheck.md
.agent-core/command/w.md
.agent-core/command/wq.md
.agent-core/skill/test-skill/SKILL.md
```

### HIVE 7: AgentDB Skills
```
.agents/skills/agentdb-advanced/SKILL.md
.agents/skills/agentdb-learning/SKILL.md
.agents/skills/agentdb-memory-patterns/SKILL.md
.agents/skills/agentdb-optimization/SKILL.md
.agents/skills/agentdb-vector-search/SKILL.md
```

### HIVE 8: Flow Nexus Skills
```
.agents/skills/flow-nexus-neural/SKILL.md
.agents/skills/flow-nexus-platform/SKILL.md
.agents/skills/flow-nexus-swarm/SKILL.md
```

### HIVE 9: Swarm/Hive Skills
```
.agents/skills/hive-mind-advanced/SKILL.md     [Current file context]
.agents/skills/swarm-advanced/SKILL.md
.agents/skills/swarm-orchestration/SKILL.md
.agents/skills/stream-chain/SKILL.md
```

### HIVE 10: Memory/Reasoning Skills
```
.agents/skills/reasoningbank-agentdb/SKILL.md
.agents/skills/reasoningbank-intelligence/SKILL.md
.agents/skills/performance-analysis/SKILL.md
```

### HIVE 11: Media/Content Skills
```
.agents/skills/google-chirp-2/SKILL.md         [STT]
.agents/skills/minimax-tts/SKILL.md            [TTS]
.agents/skills/sag/SKILL.md                    [ElevenLabs TTS]
.agents/skills/video-frames/SKILL.md           [Video processing]
.agents/skills/nano-pdf/SKILL.md               [PDF editing]
.agents/skills/openai-image-gen/SKILL.md       [Image generation]
```

### HIVE 12: Search/Research Skills
```
.agents/skills/brave-search/SKILL.md
.agents/skills/summarize/SKILL.md
.agents/skills/blogwatcher/SKILL.md
```

### HIVE 13: Utility Skills
```
.agents/skills/bitwarden/SKILL.md
.agents/skills/bitwarden/references/commands.md
.agents/skills/bitwarden/references/session.md
.agents/skills/obsidian/SKILL.md
.agents/skills/blogwatcher/SKILL.md
```

### HIVE 14: Advanced Tech Skills
```
.agents/skills/agentic-jujutsu/SKILL.md
.agents/skills/stream-chain/SKILL.md
```

### HIVE 21: @Johny Core Skills
```
.agents/skills/@johny/clawdhub/SKILL.md
.agents/skills/@johny/coding-agent/SKILL.md
.agents/skills/@johny/concept-exploration/SKILL.md
.agents/skills/@johny/deliberate-practice/SKILL.md
.agents/skills/@johny/hooks-automation/SKILL.md
.agents/skills/@johny/hooks-automation/configuration.md
.agents/skills/@johny/hooks-automation/examples.md
.agents/skills/@johny/mcporter/SKILL.md
.agents/skills/@johny/oracle/SKILL.md
.agents/skills/@johny/pair-programming/SKILL.md
.agents/skills/@johny/problem-solving/SKILL.md
.agents/skills/@johny/progress-tracking/SKILL.md
.agents/skills/@johny/qmd/SKILL.md
.agents/skills/@johny/session-logs/SKILL.md
.agents/skills/@johny/skill-builder/SKILL.md
.agents/skills/@johny/sparc-methodology/SKILL.md
.agents/skills/@johny/verification-quality/SKILL.md
```

### HIVE 22: @Johny GitHub Skills
```
.agents/skills/@johny/github/SKILL.md
.agents/skills/@johny/github-code-review/SKILL.md
.agents/skills/@johny/github-multi-repo/SKILL.md
.agents/skills/@johny/github-project-management/SKILL.md
.agents/skills/@johny/github-release-management/SKILL.md
.agents/skills/@johny/github-shared-reference.md
.agents/skills/@johny/github-workflow-automation/SKILL.md
```

### HIVE 23: @Stanley Financial Skills
```
.agents/skills/@stanley/earnings-intelligence/SKILL.md
.agents/skills/@stanley/financial-research/SKILL.md
.agents/skills/@stanley/investment-thesis/SKILL.md
.agents/skills/@stanley/market-analysis/SKILL.md
.agents/skills/@stanley/news-digest/SKILL.md
.agents/skills/@stanley/portfolio-analytics/SKILL.md
.agents/skills/@stanley/risk-management/SKILL.md
```

### HIVE 24: @Zee Core Skills
```
.agents/skills/@zee/bird/SKILL.md
.agents/skills/@zee/food-order/SKILL.md
.agents/skills/@zee/gifgrep/SKILL.md
.agents/skills/@zee/goplaces/SKILL.md
.agents/skills/@zee/home-assistant/SKILL.md
.agents/skills/@zee/local-places/SKILL.md
.agents/skills/@zee/local-places/SERVER_README.md
.agents/skills/@zee/openhue/SKILL.md
.agents/skills/@zee/ordercli/SKILL.md
.agents/skills/@zee/songsee/SKILL.md
.agents/skills/@zee/wacli/SKILL.md
.agents/skills/@zee/weather/SKILL.md
```

### HIVE 25: @Zee PIM Classic
```
.agents/skills/@zee/pim-classic/SKILL.md
.agents/skills/@zee/pim-classic/references/khal-config.md
.agents/skills/@zee/pim-classic/references/khard-config.md
.agents/skills/@zee/pim-classic/references/mbsync-config.md
.agents/skills/@zee/pim-classic/references/msmtp-config.md
.agents/skills/@zee/pim-classic/references/neomutt-config.md
.agents/skills/@zee/pim-classic/references/notmuch-config.md
.agents/skills/@zee/pim-classic/references/vdirsyncer-config.md
```

### HIVE 26: Zee Gateway Skills (packages/personas/zee/skills/)
```
packages/personas/zee/skills/1password/SKILL.md
packages/personas/zee/skills/bird/SKILL.md
packages/personas/zee/skills/blogwatcher/SKILL.md
packages/personas/zee/skills/blucli/SKILL.md
packages/personas/zee/skills/camsnap/SKILL.md
packages/personas/zee/skills/canvas/SKILL.md
packages/personas/zee/skills/coding-agent/SKILL.md
packages/personas/zee/skills/eightctl/SKILL.md
packages/personas/zee/skills/food-order/SKILL.md
packages/personas/zee/skills/gemini/SKILL.md
packages/personas/zee/skills/gifgrep/SKILL.md
packages/personas/zee/skills/gog/SKILL.md
packages/personas/zee/skills/goplaces/SKILL.md
packages/personas/zee/skills/himalaya/SKILL.md
packages/personas/zee/skills/local-places/SKILL.md
packages/personas/zee/skills/mcporter/SKILL.md
packages/personas/zee/skills/nano-banana-pro/SKILL.md
packages/personas/zee/skills/nano-pdf/SKILL.md
packages/personas/zee/skills/notion/SKILL.md
packages/personas/zee/skills/obsidian/SKILL.md
packages/personas/zee/skills/openai-image-gen/SKILL.md
packages/personas/zee/skills/openai-whisper-api/SKILL.md
packages/personas/zee/skills/openai-whisper/SKILL.md
packages/personas/zee/skills/openhue/SKILL.md
packages/personas/zee/skills/oracle/SKILL.md
packages/personas/zee/skills/ordercli/SKILL.md
packages/personas/zee/skills/sag/SKILL.md
packages/personas/zee/skills/session-logs/SKILL.md
packages/personas/zee/skills/sherpa-onnx-tts/SKILL.md
packages/personas/zee/skills/skill-creator/SKILL.md
packages/personas/zee/skills/songsee/SKILL.md
packages/personas/zee/skills/sonoscli/SKILL.md
packages/personas/zee/skills/spotify-player/SKILL.md
packages/personas/zee/skills/summarize/SKILL.md
packages/personas/zee/skills/tmux/SKILL.md
packages/personas/zee/skills/trello/SKILL.md
packages/personas/zee/skills/video-frames/SKILL.md
packages/personas/zee/skills/voice-call/SKILL.md
packages/personas/zee/skills/wacli/SKILL.md
packages/personas/zee/skills/weather/SKILL.md
packages/personas/zee/skills/zeehub/SKILL.md
```

### HIVE 27: Zee Extension Skills
```
packages/personas/zee/extensions/google-antigravity-auth/README.md
packages/personas/zee/extensions/google-gemini-cli-auth/README.md
packages/personas/zee/extensions/llm-task/README.md
packages/personas/zee/extensions/lobster/README.md
packages/personas/zee/extensions/lobster/SKILL.md
packages/personas/zee/extensions/open-prose/README.md
packages/personas/zee/extensions/open-prose/skills/prose/SKILL.md
packages/personas/zee/extensions/open-prose/skills/prose/alt-borges.md
packages/personas/zee/extensions/open-prose/skills/prose/alts/*.md (6 files)
packages/personas/zee/extensions/open-prose/skills/prose/compiler.md
packages/personas/zee/extensions/open-prose/skills/prose/help.md
packages/personas/zee/extensions/open-prose/skills/prose/prose.md
packages/personas/zee/extensions/voice-call/README.md
```

### HIVE 28: Tiara Skills
```
packages/tiara/.agents/skills/agentdb-advanced/SKILL.md
packages/tiara/.agents/skills/agentdb-learning/SKILL.md
packages/tiara/.agents/skills/agentdb-memory-patterns/SKILL.md
packages/tiara/.agents/skills/agentdb-optimization/SKILL.md
packages/tiara/.agents/skills/agentdb-vector-search/SKILL.md
packages/tiara/.agents/skills/agentic-jujutsu/SKILL.md
packages/tiara/.agents/skills/codebase-exploration/SKILL.md
packages/tiara/.agents/skills/codebase-research/SKILL.md
packages/tiara/.agents/skills/flow-nexus-neural/SKILL.md
packages/tiara/.agents/skills/flow-nexus-platform/SKILL.md
packages/tiara/.agents/skills/flow-nexus-swarm/SKILL.md
packages/tiara/.agents/skills/hive-mind-advanced/SKILL.md
packages/tiara/.agents/skills/hooks-automation/SKILL.md
packages/tiara/.agents/skills/orchestration/SKILL.md
packages/tiara/.agents/skills/pair-programming/SKILL.md
packages/tiara/.agents/skills/performance-analysis/SKILL.md
packages/tiara/.agents/skills/reasoningbank-agentdb/SKILL.md
packages/tiara/.agents/skills/reasoningbank-intelligence/SKILL.md
packages/tiara/.agents/skills/skill-builder/SKILL.md
packages/tiara/.agents/skills/sparc-methodology/SKILL.md
packages/tiara/.agents/skills/strategic-advisor/SKILL.md
packages/tiara/.agents/skills/stream-chain/SKILL.md
packages/tiara/.agents/skills/swarm-advanced/SKILL.md
packages/tiara/.agents/skills/swarm-orchestration/SKILL.md
packages/tiara/.agents/skills/verification-quality/SKILL.md
```

### HIVE 36: Root Documentation
```
README.md
BROWSER_OPTIONS.md
STYLE_GUIDE.md
SECURITY.md
LICENSE
TESTING.md
UPSTREAM_TRIAGE_122-221.md
.jules/bolt.md
.jules/sentinel.md
.Jules/palette.md
```

### HIVE 37: Architecture Docs
```
docs/architecture/ADR-001-SURFACE-LAYER.md
docs/architecture/adr-001-session-architecture.md
docs/architecture/agent-personas.md
docs/architecture/plugin-system.md
docs/architecture/resource-graph-model.md
docs/architecture/session-system.md
docs/architecture/terraform-integration.md
docs/hosted/README.md
docs/hosted/billing.md
docs/hosted/security.md
docs/plans/WIRING-PLAN.md
docs/plans/retry-improvements.md
docs/plans/rust-memory-boundary.md
```

### HIVE 38: Reference Templates
```
packages/personas/zee/docs/reference/templates/AGENTS.dev.md
packages/personas/zee/docs/reference/templates/AGENTS.md
packages/personas/zee/docs/reference/templates/BOOT.md
packages/personas/zee/docs/reference/templates/BOOTSTRAP.md
packages/personas/zee/docs/reference/templates/HEARTBEAT.md
packages/personas/zee/docs/reference/templates/IDENTITY.dev.md
packages/personas/zee/docs/reference/templates/IDENTITY.md
packages/personas/zee/docs/reference/templates/SOUL.dev.md
packages/personas/zee/docs/reference/templates/SOUL.md
packages/personas/zee/docs/reference/templates/TOOLS.dev.md
packages/personas/zee/docs/reference/templates/TOOLS.md
packages/personas/zee/docs/reference/templates/USER.dev.md
packages/personas/zee/docs/reference/templates/USER.md
packages/tiara/bin/init/templates/CLAUDE.md
packages/tiara/.agents/templates/CLAUDE_VERIFIED.md
```

### HIVE 39: Zee Docs - Core
```
packages/personas/zee/README.md
packages/personas/zee/CHANGELOG.md
packages/personas/zee/CONTRIBUTING.md
packages/personas/zee/SECURITY.md
packages/personas/zee/docs/index.md
packages/personas/zee/docs/start/*.md (7 files)
packages/personas/zee/docs/help/*.md (3 files)
packages/personas/zee/docs/install/*.md (12 files)
packages/personas/zee/docs/platforms/*.md (10 files)
packages/personas/zee/docs/concepts/agent.md
packages/personas/zee/docs/concepts/architecture.md
packages/personas/zee/docs/concepts/memory.md
packages/personas/zee/docs/concepts/sessions.md
```

### HIVE 40: Zee Docs - Gateway
```
packages/personas/zee/docs/gateway/*.md (25 files)
packages/personas/zee/docs/gateway/security/*.md (2 files)
packages/personas/zee/docs/channels/*.md (6 files)
packages/personas/zee/docs/providers/*.md (17 files)
```

### HIVE 41: Zee Docs - CLI
```
packages/personas/zee/docs/cli/*.md (35 files)
```

### HIVE 42: Zee Docs - Concepts
```
packages/personas/zee/docs/concepts/*.md (25 files)
```

### HIVE 43: Tiara CLAUDE.md
```
packages/tiara/CLAUDE.md
```

### HIVE 44: Tiara Agents
```
packages/tiara/.agents/agents/**/*.md (50+ files)
```

### HIVE 45: Tiara Commands
```
packages/tiara/.agents/commands/**/*.md (40+ files)
```

### HIVE 46: Tiara Skills
```
packages/tiara/.agents/skills/**/*.md (25 files)
```

### HIVE 47: Tiara Documentation
```
packages/tiara/docs/**/*.md (100+ files)
```

### HIVE 48: Tiara Templates
```
packages/tiara/bin/init/templates/**/*.md (20 files)
```

### HIVE 49: Hooks & Automation
```
packages/personas/zee/src/hooks/bundled/boot-md/HOOK.md
packages/personas/zee/src/hooks/bundled/command-logger/HOOK.md
packages/personas/zee/src/hooks/bundled/session-memory/HOOK.md
packages/personas/zee/src/hooks/bundled/soul-evil/HOOK.md
packages/personas/zee/src/hooks/bundled/soul-evil/README.md
packages/personas/zee/src/hooks/bundled/README.md
packages/tiara/bin/init/templates/commands/hooks/*.md (9 files)
packages/tiara/.agents/commands/hooks/*.md (6 files)
```

### HIVE 50: Test Fixtures & Misc
```
packages/agent-core/test/config/fixtures/*.md (5 files)
packages/agent-core/src/acp/README.md
packages/agent-core/src/provider/sdk/openai-compatible/src/README.md
packages/agent-core/test/compat/**/*.md (4 files)
packages/tiara/.agents/sessions/*-summary.md (session summaries)
```

---

## STATISTICS SUMMARY

| Category | Hive Range | Approximate Files |
|----------|------------|-------------------|
| Core Personas | 1-6 | 29 |
| Shared Skills | 7-20 | 35 |
| Persona-Specific Skills | 21-35 | 125 |
| Architecture & Reference | 36-42 | 120 |
| Tiara Orchestration | 43-48 | 240 |
| Specialized | 49-50 | 25 |
| **TOTAL** | **1-50** | **~574** |

---

## CONSENSUS RECOMMENDATIONS

Based on Hive Mind analysis:

### High Priority Consolidation Targets:
1. **Hive 5** (Agent Definitions) - 3 files are essentially duplicates (AGENTS.md)
2. **Hive 7** (AgentDB Skills) - Duplicated in .agents/skills/ and packages/tiara/.agents/skills/
3. **Hive 26 vs Hive 24** - Zee skills duplicated between .agents/skills/@zee/ and packages/personas/zee/skills/

### Cross-Hive Dependencies:
- Tiara (Hives 43-48) depends on Persona Skills (Hives 21-35)
- Core Personas (Hives 1-3) depend on Shared Layer (Hive 4)
- All Skills depend on AgentDB (Hive 7)

### Suggested Refactoring:
1. Merge duplicate AGENTS.md files into single source of truth
2. Consolidate duplicate skills between .agents/skills/ and packages/tiara/.agents/skills/
3. Remove deprecated persona agent definitions from .agent-core/agent/

---

*Generated by Hive Mind Classification System v1.0*
*Classification Date: 2026-01-31*
*Total Hives Active: 50*
