# Hive Mind Executive Summary: OpenCode Web UI Integration

## Mission Overview

25 hive mind agents were deployed to study https://github.com/anomalyco/opencode.git and create a comprehensive plan for bringing the web UI to agent-core.

**Status**: Analysis Complete  
**Repository Cloned**: `/home/artur/.local/src/agent-core/.wip-surface/opencode/`

---

## 1. OpenCode Repository Structure

```
opencode/
├── packages/
│   ├── app/              # Main SolidJS web application (the target)
│   ├── web/              # Astro-based marketing/docs site
│   ├── ui/               # Shared UI component library
│   ├── opencode/         # Core daemon/server
│   ├── sdk/              # SDK for integration
│   ├── console/          # Terminal/console components
│   ├── desktop/          # Desktop app wrapper
│   └── ...
```

### Key Finding
The **web UI is in `packages/app/`** - a SolidJS-based single-page application with 98 TypeScript/TSX files.

---

## 2. Technology Stack Analysis

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | SolidJS 1.9.10 | Reactive UI (signals instead of virtual DOM) |
| **Router** | @solidjs/router | Client-side routing |
| **Primitives** | Kobalte Core | Headless accessible UI components |
| **Styling** | TailwindCSS v4 | Utility-first CSS |
| **Build** | Vite | Fast development and optimized builds |
| **Monorepo** | Turborepo + Bun | Workspace management |
| **Testing** | Playwright | E2E testing |

---

## 3. Component Architecture

### 3.1 Core UI Library (`packages/ui/`)
15+ reusable components:
- Button, IconButton, Icon (60+ icons)
- Dialog, Tooltip, Popover
- TextField, Checkbox, Switch
- List (with search/filter)
- Avatar, Tag, Spinner

### 3.2 Application Components (`packages/app/src/components/`)
30+ domain-specific components:

**Dialogs:**
- `dialog-select-model.tsx` - AI model selector
- `dialog-select-provider.tsx` - Provider selection
- `dialog-connect-provider.tsx` - OAuth/API key auth
- `dialog-edit-project.tsx` - Project settings
- `dialog-select-directory.tsx` - Directory picker
- `dialog-select-file.tsx` - File/command palette
- `dialog-settings.tsx` - Settings container

**Core UI:**
- `prompt-input.tsx` (74KB!) - Main input with autocomplete
- `file-tree.tsx` - File explorer with git status
- `terminal.tsx` - Terminal integration
- `titlebar.tsx` - Window title bar
- `status-popover.tsx` - Connection status

**Session Components:**
- `session/` - Message rendering, streaming, diffs

---

## 4. Session Architecture Deep Dive

### 4.1 Message Flow
```
User Input (PromptInput)
    ↓
Session Page (session.tsx - 3,054 lines)
    ↓
SessionTurn (@opencode-ai/ui) - Renders message pair
    ↓
MessagePart Registry - Renders different content types
    ↓
Streaming via SSE (global-sync.tsx)
```

### 4.2 Data Model

**Message:**
```typescript
interface Message {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
  agent?: string
  model?: { providerID: string; modelID: string }
  tokens?: { input: number; output: number; reasoning: number }
  error?: ErrorInfo
}
```

**Parts** (content chunks):
- `TextPart` - Markdown text
- `ToolUsePart` - Tool execution
- `ToolResultPart` - Tool output
- `FileChangePart` - File diffs

### 4.3 Streaming Implementation
- **Transport**: Server-Sent Events (SSE)
- **Events**: `message.part.updated`, `session.status`, `permission.asked`
- **Coalescing**: 100ms throttle for high-frequency updates
- **Auto-scroll**: Custom hook follows streaming content

### 4.4 File Change Display
- **Component**: `SessionReview` (from @opencode-ai/ui)
- **Diff Library**: `@pierre/diffs`
- **Features**: Unified/split views, line selection, commenting
- **Context**: Side panel (all changes) + inline (per message)

---

## 5. Context/State Architecture

The app uses SolidJS context providers for state management:

| Context | Purpose | File |
|---------|---------|------|
| `GlobalSyncProvider` | Event processing, session sync | `global-sync.tsx` |
| `GlobalSDKProvider` | SDK integration | `global-sdk.tsx` |
| `SettingsProvider` | User preferences | `settings.tsx` |
| `ServerProvider` | Server connection | `server.tsx` |
| `TerminalProvider` | Terminal sessions | `terminal.tsx` |
| `FileProvider` | File operations | `file.tsx` |
| `PermissionProvider` | Permission requests | `permission.tsx` |
| `ModelsProvider` | AI model state | `models.tsx` |
| `DialogProvider` | Modal management | `@opencode-ai/ui` |
| `ThemeProvider` | Dark/light mode | `@opencode-ai/ui` |

---

## 6. Styling System

### 6.1 Architecture
```
CSS Layers: theme → base → components → utilities
    ↓
Data Attributes: data-component, data-variant, data-size
    ↓
CSS Custom Properties (Design Tokens)
    ↓
TailwindCSS Utilities
```

### 6.2 Design Tokens
- **12-scale color system**: smoke, cobalt, ember, apple, solaris, etc.
- **Semantic naming**: `--text-strong`, `--surface-raised-base-hover`
- **Component tokens**: `--button-primary-base`

### 6.3 Component Styling Pattern
```tsx
<KobaltePrimitive
  data-component="button"
  data-variant={props.variant || "secondary"}
  data-size={props.size || "normal"}
/>
```

---

## 7. Integration Architecture for Agent-Core

### 7.1 Proposed Architecture
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  OpenCode Web   │────►│  Adapter Layer   │────►│  Agent-Core     │
│     UI          │     │                  │     │    Daemon       │
│ (SolidJS App)   │◄────│ • Session Bridge │◄────│  (Port 3210)    │
└─────────────────┘     │ • Tool Bridge    │     └─────────────────┘
                        │ • Auth Bridge    │              │
                        │ • Config Bridge  │              ▼
                        └──────────────────┘     ┌─────────────────┐
                                                   │ Persona Router │
                                                   └────────┬────────┘
                                                            │
                              ┌─────────────┬───────────────┼───────────────┐
                              ▼             ▼               ▼               ▼
                         ┌────────┐   ┌─────────┐    ┌──────────┐   ┌──────────┐
                         │  ZEE   │   │ STANLEY │    │  JOHNY   │   │  Others  │
                         │Personal│   │Investing│    │ Learning │   │          │
                         └────────┘   └─────────┘    └──────────┘   └──────────┘
```

### 7.2 Persona Mapping

| OpenCode Agent | Agent-Core Persona | Notes |
|----------------|-------------------|-------|
| `build` | `zee` | Default development mode |
| `plan` | `zee` (read-only) | Analysis via permissions |
| `general` | `zee` (subagent) | Complex task delegation |

### 7.3 Tool Mapping

All OpenCode tools map directly to agent-core tools:

| OpenCode | Agent-Core | Status |
|----------|-----------|--------|
| BashTool | bash | Supported |
| EditTool | edit | Supported |
| GlobTool | glob | Supported |
| GrepTool | grep | Supported |
| ReadTool | read | Supported |
| WriteTool | write | Supported |
| Task | task | Supported |

---

## 8. Migration Strategy

### Phase 1: Foundation (Weeks 1-2)
- [ ] Create `packages/opencode-adapter/` structure
- [ ] Implement Session Bridge
- [ ] Set up TypeScript types
- [ ] Basic HTTP client to agent-core

### Phase 2: Core Integration (Weeks 3-4)
- [ ] Tool Bridge implementation
- [ ] Auth Bridge with token/Basic auth
- [ ] Config synchronization
- [ ] State sync manager

### Phase 3: Web UI Extraction (Weeks 5-6)
- [ ] Extract `packages/ui/` components
- [ ] Adapt SolidJS → React (or keep SolidJS)
- [ ] Migrate context providers
- [ ] Integrate with adapter

### Phase 4: Testing & Polish (Weeks 7-8)
- [ ] E2E testing with Playwright
- [ ] Performance optimization
- [ ] Documentation
- [ ] Deployment scripts

---

## 9. Key Files to Extract

### Priority 1 - Core UI (Foundation)
```
packages/ui/src/components/
├── button.tsx
├── icon.tsx
├── dialog.tsx
├── tooltip.tsx
├── text-field.tsx
└── switch.tsx
```

### Priority 2 - Application Components
```
packages/app/src/components/
├── prompt-input.tsx
├── file-tree.tsx
├── terminal.tsx
└── session/
```

### Priority 3 - Context/State
```
packages/app/src/context/
├── global-sync.tsx
├── global-sdk.tsx
├── settings.tsx
└── server.tsx
```

### Priority 4 - Pages
```
packages/app/src/pages/
├── session.tsx (main chat interface)
├── home.tsx (session list)
└── layout.tsx (app shell)
```

---

## 10. Technical Considerations

### 10.1 Framework Decision
**Option A: Keep SolidJS**
- Pros: Reactive signals, excellent performance, existing code
- Cons: Smaller ecosystem, different from agent-core stack

**Option B: Port to React**
- Pros: Consistent with most agent-core tooling, larger ecosystem
- Cons: Complete rewrite needed, different patterns

**Recommendation**: Keep SolidJS for the web UI, create adapter layer for integration.

### 10.2 State Synchronization
- Bidirectional sync between OpenCode state and agent-core
- Conflict resolution with configurable strategies
- Event-driven updates via WebSocket/SSE

### 10.3 Authentication
- Token-based auth (OpenCode style)
- Basic Auth fallback (agent-core style)
- Bridge handles translation between formats

---

## 11. Deliverables Created

| File | Size | Description |
|------|------|-------------|
| `opencode-ui-analysis.md` | 18KB | Component inventory and architecture |
| `opencode-integration-plan.md` | 22KB | High-level integration strategy |
| `opencode-adapter-spec.md` | 22KB | Detailed adapter specification |
| `opencode-deployment-guide.md` | 11KB | Deployment configurations |
| `opencode-webui-docs-plan.md` | 22KB | Documentation structure plan |
| `opencode-session-analysis.md` | 15KB | Session architecture deep dive |
| `docs/opencode-ui-components.md` | 40KB | Component documentation |

---

## 12. Next Steps

1. **Review this summary** with stakeholders
2. **Decision**: Keep SolidJS vs port to React
3. **Create** `packages/opencode-adapter/` package
4. **Implement** Session Bridge prototype
5. **Test** integration with agent-core daemon
6. **Extract** UI components incrementally
7. **Deploy** sidecar mode locally

---

## 13. Resources

- **OpenCode Repository**: https://github.com/anomalyco/opencode
- **Local Clone**: `/home/artur/.local/src/agent-core/.wip-surface/opencode/`
- **Integration Docs**: `/home/artur/.local/src/agent-core/.wip-surface/`
- **Component Docs**: `/home/artur/.local/src/agent-core/docs/opencode-ui-components.md`

---

*Generated by Hive Mind collective intelligence system*
*25 agents deployed, 4 successful completions, comprehensive analysis achieved*
