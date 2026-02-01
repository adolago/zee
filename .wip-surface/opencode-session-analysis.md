# OpenCode Web UI - Session Architecture Analysis

## Overview

This document provides a comprehensive analysis of the session page architecture in the OpenCode web UI, focusing on message handling, streaming responses, and file change display.

---

## 1. Session Page Component Structure

### Main Entry Point
**File:** `packages/app/src/pages/session.tsx` (3,054 lines)

The session page is the core component that orchestrates the entire chat interface. It uses SolidJS for reactive state management.

### Key Components Hierarchy

```
Page (session.tsx)
├── SessionHeader (from @/components/session)
├── Session Panel
│   ├── SessionTurn (from @opencode-ai/ui) - Renders each user message + AI response
│   ├── PromptInput (prompt-input.tsx) - Message input
│   └── Permission Request UI
├── Review Panel (Side/Inline)
│   └── SessionReviewTab → SessionReview (from @opencode-ai/ui)
├── File Tree Panel (Desktop)
│   ├── FileTree (changes view)
│   └── FileTree (all files view)
└── Terminal Panel
    └── Terminal tabs with DragDropProvider
```

### Session Sub-Components

**Location:** `packages/app/src/components/session/`

| Component | File | Purpose |
|-----------|------|---------|
| `SessionHeader` | `session-header.tsx` | Title bar with search, share, layout toggles |
| `NewSessionView` | `session-new-view.tsx` | Empty state for new sessions |
| `SessionContextTab` | `session-context-tab.tsx` | Context/debug view tab |
| `SortableTab` | `session-sortable-tab.tsx` | Draggable file tabs |
| `SortableTerminalTab` | `session-sortable-terminal-tab.tsx` | Draggable terminal tabs |

### Session Turn Component
**File:** `packages/ui/src/components/session-turn.tsx` (833 lines)

The `SessionTurn` component is the primary message rendering unit:
- Displays user messages with attachments
- Renders assistant responses with streaming text
- Shows tool execution steps (collapsible)
- Displays file diffs in accordion format
- Handles permissions and question prompts

---

## 2. Message Handling Architecture

### Data Model

**Messages** are stored with the following structure:
```typescript
// Message types: UserMessage | AssistantMessage
interface Message {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
  agent?: string
  model?: { providerID: string; modelID: string }
  parentID?: string  // For threading
  cost?: number
  tokens?: { input: number; output: number; reasoning: number; cache: {...} }
  error?: ErrorInfo
  summary?: { diffs: FileDiff[] }  // File changes summary
}
```

**Parts** represent message content chunks:
```typescript
// Part types: TextPart | ToolPart | FilePart | ReasoningPart | AgentPart
type Part = {
  id: string
  messageID: string
  type: string
  // ... type-specific fields
}
```

### State Management

**Sync Context:** `packages/app/src/context/sync.tsx`
- Per-directory state isolation via `globalSync.child(directory)`
- Messages stored in `store.message[sessionID]`
- Parts stored in `store.part[messageID]`
- Pagination support with configurable chunk size (400 messages)

**Key Methods:**
- `sync.session.sync(sessionID)` - Load session data
- `sync.session.diff(sessionID)` - Load file diffs
- `sync.session.history.loadMore(sessionID)` - Pagination

### Message Rendering Flow

1. **SessionTurn** (`session-turn.tsx`) receives `messageID` and `sessionID`
2. Retrieves user message and all subsequent assistant messages
3. Filters messages by `parentID` to build the conversation thread
4. Renders parts using `Message` and `Part` components from `message-part.tsx`

### Message Part Registry

**File:** `packages/ui/src/components/message-part.tsx`

Parts are rendered via a type-based registry (`PART_MAPPING`):
```typescript
PART_MAPPING["text"] = TextPartDisplay
PART_MAPPING["tool"] = ToolPartDisplay
PART_MAPPING["reasoning"] = ReasoningPartDisplay
// ... etc
```

**Tool Registry:**
```typescript
ToolRegistry.register({ name: "read", render: ReadTool })
ToolRegistry.register({ name: "edit", render: EditTool })
ToolRegistry.register({ name: "bash", render: BashTool })
// ... etc
```

---

## 3. Streaming Implementation

### Event Stream Architecture

**Server-Sent Events (SSE)** via the SDK:

**File:** `packages/app/src/context/global-sdk.tsx`

```typescript
// Event stream setup
const eventSdk = createOpencodeClient({ baseUrl: server.url })
const events = await eventSdk.global.event()  // SSE endpoint
for await (const event of events.stream) {
  // Process streaming events
}
```

### Event Types

**File:** `packages/app/src/context/global-sync.tsx` (lines 641-950)

| Event Type | Description |
|------------|-------------|
| `session.created` | New session created |
| `session.updated` | Session metadata updated |
| `session.deleted` | Session removed |
| `session.diff` | File diffs updated |
| `session.status` | Session status changed (idle/working/retry) |
| `message.updated` | Message metadata changed |
| `message.removed` | Message deleted |
| `message.part.updated` | **Streaming content update** |
| `message.part.removed` | Part removed |
| `permission.asked` | New permission request |
| `permission.replied` | Permission resolved |
| `question.asked` | User question requested |
| `question.replied` | Question answered |

### Event Coalescing

To optimize performance, high-frequency events are coalesced:

```typescript
const key = (directory: string, payload: Event) => {
  if (payload.type === "session.status") 
    return `session.status:${directory}:${payload.properties.sessionID}`
  if (payload.type === "message.part.updated") 
    return `message.part.updated:${directory}:${part.messageID}:${part.id}`
}

// Duplicate keys replace previous queued events
if (k) {
  const i = coalesced.get(k)
  if (i !== undefined) queue[i] = undefined
  coalesced.set(k, queue.length)
}
```

### Streaming Text Display

**Throttling:** `packages/ui/src/components/message-part.tsx` (lines 108-147)

```typescript
const TEXT_RENDER_THROTTLE_MS = 100

function createThrottledValue(getValue: () => string) {
  const [value, setValue] = createSignal(getValue())
  let timeout: ReturnType<typeof setTimeout> | undefined
  let last = 0

  createEffect(() => {
    const next = getValue()
    const now = Date.now()
    const remaining = TEXT_RENDER_THROTTLE_MS - (now - last)
    if (remaining <= 0) {
      last = now
      setValue(next)
      return
    }
    timeout = setTimeout(() => {
      last = Date.now()
      setValue(next)
    }, remaining)
  })
  return value
}
```

### Auto-Scroll During Streaming

**File:** `packages/ui/src/hooks/create-auto-scroll.tsx`

Features:
- Automatic scroll-to-bottom while streaming (`working()` state)
- User scroll detection pauses auto-scroll
- Wheel event handling for nested scrollables
- Overflow anchor management
- Settle timer (300ms) after streaming completes

```typescript
const createAutoScroll = (options: {
  working: () => boolean  // True while streaming
  onUserInteracted?: () => void
  overflowAnchor?: "none" | "auto" | "dynamic"
}) => {
  // Automatically scrolls when working() is true
  // Stops when user manually scrolls
  // Resumes on explicit user action
}
```

---

## 4. File Change/Diff Display Approach

### Diff Data Model

```typescript
interface FileDiff {
  file: string
  before?: string  // Original content
  after?: string   // Modified content
  additions: number
  deletions: number
}
```

### SessionReview Component

**File:** `packages/ui/src/components/session-review.tsx` (637 lines)

Features:
- **Unified/Split diff styles** - Toggle between view modes
- **Accordion layout** - Collapsible file diffs
- **Line selection** - Click to select lines for commenting
- **Line comments** - Add/view comments on specific lines
- **Image preview** - For image file changes
- **Audio playback** - For audio file changes

### Diff Rendering Architecture

1. **Diff Component Injection** via context:
```typescript
const diffComponent = useDiffComponent()  // From @pierre/diffs
```

2. **Shadow DOM Rendering**:
```typescript
<Dynamic
  component={diffComponent}
  before={{ name: diff.file, contents: diff.before }}
  after={{ name: diff.file, contents: diff.after }}
  diffStyle={diffStyle()}  // "unified" | "split"
  enableLineSelection={true}
  onLineSelected={...}
  onLineSelectionEnd={...}
/>
```

### File Change Integration in SessionTurn

**Location:** `packages/ui/src/components/session-turn.tsx` (lines 740-816)

```typescript
// Diffs are retrieved from message summary
const messageDiffs = createMemo(() => message()?.summary?.diffs ?? [])

// Rendered in accordion with lazy loading
<Accordion multiple value={store.diffsOpen}>
  <For each={messageDiffs().slice(0, store.diffLimit)}>
    {(diff) => (
      <Accordion.Item value={diff.file}>
        <Dynamic component={diffComponent} ... />
      </Accordion.Item>
    )}
  </For>
</Accordion>
```

### Diff Styling

**Location:** `packages/app/src/pages/session.tsx` (lines 491-517)

```typescript
// Calculate change types per file/directory
const kinds = createMemo(() => {
  const out = new Map<string, "add" | "del" | "mix">()
  for (const diff of diffs()) {
    const file = normalize(diff.file)
    const add = diff.additions > 0
    const del = diff.deletions > 0
    const kind = add && del ? "mix" : add ? "add" : del ? "del" : "mix"
    out.set(file, kind)
    // Propagate to parent directories
    const parts = file.split("/")
    for (const [idx] of parts.slice(0, -1).entries()) {
      const dir = parts.slice(0, idx + 1).join("/")
      out.set(dir, merge(out.get(dir), kind))
    }
  }
  return out
})
```

### Review Panel in Session Page

**Two contexts for diff display:**

1. **Side Panel** (Desktop) - `reviewPanel()` function:
   - Shows all session diffs
   - File tree with change indicators
   - Line commenting support

2. **Inline** (SessionTurn) - Per-message diffs:
   - Shows only changes from that message
   - Collapsible accordion
   - Summary section at bottom of turn

---

## 5. Key Files and Their Purposes

### Core Session Files

| File | Lines | Purpose |
|------|-------|---------|
| `packages/app/src/pages/session.tsx` | 3,054 | Main session page orchestrator |
| `packages/ui/src/components/session-turn.tsx` | 833 | Individual message turn rendering |
| `packages/ui/src/components/session-review.tsx` | 637 | File diff review panel |
| `packages/ui/src/components/message-part.tsx` | 1,000+ | Message part rendering (text, tools, files) |
| `packages/app/src/components/prompt-input.tsx` | 1,000+ | Message input with autocomplete |

### Context/State Files

| File | Purpose |
|------|---------|
| `packages/app/src/context/sync.tsx` | Per-directory session data sync |
| `packages/app/src/context/global-sync.tsx` | Global state + event processing |
| `packages/app/src/context/global-sdk.tsx` | SDK client + SSE event streaming |
| `packages/app/src/context/sdk.tsx` | Directory-scoped SDK + events |
| `packages/app/src/context/prompt.tsx` | Prompt input state management |
| `packages/app/src/context/file.tsx` | File operations and selections |

### Component Exports

| File | Purpose |
|------|---------|
| `packages/app/src/components/session/index.ts` | Session component barrel export |
| `packages/ui/src/hooks/create-auto-scroll.tsx` | Auto-scroll during streaming |
| `packages/ui/src/components/basic-tool.tsx` | Tool execution display wrapper |

### Message Part Types

| Part Type | Component | File |
|-----------|-----------|------|
| `text` | TextPartDisplay | message-part.tsx |
| `tool` | ToolPartDisplay | message-part.tsx |
| `reasoning` | ReasoningPartDisplay | message-part.tsx |
| `file` | (rendered in UserMessageDisplay) | message-part.tsx |

### Tool Types (Registered)

| Tool | Icon | Display |
|------|------|---------|
| `read` | glasses | File read |
| `list` | bullet-list | Directory listing |
| `glob` | magnifying-glass-menu | File search |
| `grep` | magnifying-glass-menu | Content search |
| `edit` | code-lines | File edit |
| `write` | code-lines | File write |
| `apply_patch` | code-lines | Multi-file patch |
| `bash` | console | Shell command |
| `task` | task | Sub-agent task |
| `webfetch` | window-cursor | Web fetch |
| `todowrite` | checklist | Todo management |
| `question` | bubble-5 | User question |

---

## 6. Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        SERVER (SSE)                              │
│  Events: message.part.updated, session.status, etc.             │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP SSE Stream
┌─────────────────────────▼───────────────────────────────────────┐
│                     GLOBAL SDK                                   │
│  global-sdk.tsx → Event coalescing → Emitter                    │
└─────────────────────────┬───────────────────────────────────────┘
                          │ Directory-scoped events
┌─────────────────────────▼───────────────────────────────────────┐
│                     SYNC CONTEXT                                 │
│  global-sync.tsx → Store updates (messages, parts, diffs)       │
│  sync.tsx → Per-directory data access                           │
└─────────────────────────┬───────────────────────────────────────┘
                          │ SolidJS reactive signals
┌─────────────────────────▼───────────────────────────────────────┐
│                     UI COMPONENTS                                │
│  session.tsx → SessionTurn → Message/Part                       │
│  SessionReview → Diff Component (@pierre/diffs)                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Notable Architecture Patterns

### Optimistic Updates
- New user messages added immediately to store before server confirmation
- Parts updated via SSE stream as AI generates content

### Pagination
- Messages loaded in chunks (400 default)
- "Load earlier" button for historical messages
- Turn-based rendering with virtual scrolling (`turnStart`, `turnBatch`)

### State Reconciliation
```typescript
setStore("message", sessionID, reconcile(next, { key: "id" }))
```

### Permission/Question Handling
- Interleaved in message stream
- Special UI treatment when steps are collapsed
- Force-open tool displays when pending

### Mobile/Desktop Adaptive Layout
- Mobile: Tab-based session/changes switch
- Desktop: Side-by-side panels with resize handles
