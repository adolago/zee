# OpenCode Chat Interface Analysis

## Overview

This document provides a deep dive into OpenCode's chat system, analyzing the component hierarchy, message handling, streaming implementation, and UI patterns. This analysis is intended to inform the design of a similar chat UI for agent-core.

---

## 1. Chat Component Hierarchy

### Top-Level Structure

```
session.tsx (Page Component)
├── SessionHeader
├── SessionPanel (Main chat area)
│   ├── Auto-scroll container with gesture detection
│   ├── SessionTurn components (one per user message)
│   └── PromptInput (Composer at bottom)
├── FileTree/Review Panel (Side panel)
└── TerminalPanel (Bottom panel, optional)
```

### Core UI Components (packages/ui/src/components/)

| Component | Purpose |
|-----------|---------|
| `SessionTurn` | Renders a complete turn (user message + assistant responses) |
| `Message` / `MessagePart` | Renders individual messages and their parts |
| `Part` | Dynamic component registry for different part types |
| `BasicTool` | Collapsible tool display wrapper |
| `Markdown` | Markdown rendering with copy buttons |
| `Code` | Code display with syntax highlighting (via @pierre/diffs) |
| `ImagePreview` | Modal image viewer |
| `MessageNav` | Message navigation sidebar |

### Component Registration Pattern

OpenCode uses a registry pattern for extensible part rendering:

```typescript
// PART_MAPPING registry for message parts
export const PART_MAPPING: Record<string, PartComponent | undefined> = {}

// Tool registry for tool-specific rendering
export const ToolRegistry = {
  register: registerTool,
  render: getTool,
}

// Registration example:
ToolRegistry.register({
  name: "read",
  render(props) { /* ... */ }
})
```

---

## 2. Message Types and Structures

### Message Types (SDK)

```typescript
// From @opencode-ai/sdk/v2/client
interface Message {
  id: string
  sessionID: string
  role: "user" | "assistant" | "system"
  time: { created: number; completed?: number }
  agent?: string
  model?: { providerID: string; modelID: string }
  parentID?: string  // For threading
  error?: ErrorInfo
}

interface UserMessage extends Message {
  role: "user"
}

interface AssistantMessage extends Message {
  role: "assistant"
}
```

### Part Types

```typescript
type Part =
  | TextPart      // { type: "text", text: string }
  | FilePart      // { type: "file", path: string, mime: string, url?: string }
  | ToolPart      // { type: "tool", tool: string, callID: string, state: ToolState }
  | ReasoningPart // { type: "reasoning", text: string }
  | AgentPart     // { type: "agent", name: string }

interface ToolState {
  status: "pending" | "running" | "completed" | "error"
  input: Record<string, any>
  output?: string
  error?: string
  metadata?: Record<string, any>
}
```

### Prompt/Composer Parts (App-level)

```typescript
type ContentPart =
  | TextPart            // { type: "text", content: string, start: number, end: number }
  | FileAttachmentPart  // { type: "file", path: string, selection?: FileSelection }
  | AgentPart           // { type: "agent", name: string }
  | ImageAttachmentPart // { type: "image", id, filename, mime, dataUrl }
```

---

## 3. Streaming Message Implementation

### Auto-Scroll System

**File:** `packages/ui/src/hooks/create-auto-scroll.tsx`

Key features:
- **Smart auto-scroll**: Only scrolls when user is at bottom
- **User scroll detection**: Wheel events, scroll gestures, interaction
- **Overflow anchor management**: Dynamic overflow-anchor CSS property
- **Settling period**: 300ms grace period after streaming completes

```typescript
export interface AutoScrollOptions {
  working: () => boolean           // Is streaming/active
  onUserInteracted?: () => void   // Callback on user scroll
  overflowAnchor?: "none" | "auto" | "dynamic"
  bottomThreshold?: number         // Pixels from bottom to consider "at bottom"
}

// Returns:
{
  scrollRef: (el: HTMLElement | undefined) => void
  contentRef: (el: HTMLElement | undefined) => void
  handleScroll: () => void
  handleInteraction: () => void
  pause: () => void           // Stop auto-scroll
  resume: () => void          // Resume auto-scroll
  forceScrollToBottom: () => void
  userScrolled: () => boolean
}
```

### Streaming Text Throttling

**File:** `packages/ui/src/components/message-part.tsx`

Text rendering is throttled to prevent excessive re-renders during streaming:

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
    // Schedule update
    timeout = setTimeout(() => {
      last = Date.now()
      setValue(next)
    }, remaining)
  })
  return value
}
```

### DOM Morphing for Smooth Updates

**File:** `packages/ui/src/components/markdown.tsx`

Uses `morphdom` for efficient DOM updates without full re-renders:

```typescript
morphdom(container, temp, {
  childrenOnly: true,
  onBeforeElUpdated: (fromEl, toEl) => {
    if (fromEl.isEqualNode(toEl)) return false
    // Preserve code blocks during streaming
    if (fromEl.getAttribute("data-component") === "markdown-code") {
      // Handle incremental updates
      return false
    }
    return true
  },
})
```

---

## 4. Input/Composer Components

### PromptInput Component Structure

**File:** `packages/app/src/components/prompt-input.tsx`

```
PromptInput
├── Popover ("@" mentions / "/" commands)
├── Context Items (file chips with selections)
├── Image Attachments (thumbnails)
├── ContentEditable Editor
│   ├── Text rendering
│   ├── File "pills" (data-type="file")
│   └── Agent "pills" (data-type="agent")
└── Toolbar
    ├── Mode indicator (normal/shell)
    ├── Agent selector
    ├── Model selector
    ├── Variant selector
    └── Submit button
```

### Content-Editable Architecture

Instead of a textarea, OpenCode uses a `contenteditable` div for rich content:

```typescript
// DOM structure in editor:
// Text nodes for plain text
// <span data-type="file" data-path="...">@path/to/file</span> for files
// <span data-type="agent" data-name="...">@agent</span> for agents
// <br> for newlines

// Parsing from DOM to parts:
const parseFromDOM = (): Prompt => {
  const parts: Prompt = []
  // Walks DOM tree, extracts text nodes and special elements
  // Converts to typed parts with positions
}
```

### Key Features

1. **@ Mentions**: Type `@` to trigger file/agent search popover
2. **/ Commands**: Type `/` for slash commands
3. **Shell Mode**: Type `!` at start for shell commands
4. **History Navigation**: ArrowUp/ArrowDown to navigate prompt history
5. **Image Attachments**: Drag-drop or paste images
6. **Context Items**: Separate from editor - shows file selections

### IME Support

```typescript
const [composing, setComposing] = createSignal(false)
const isImeComposing = (event: KeyboardEvent) => 
  event.isComposing || composing() || event.keyCode === 229

// Handlers:
onCompositionStart={() => setComposing(true)}
onCompositionEnd={() => setComposing(false)}
```

---

## 5. Markdown Rendering Approach

### Marked Configuration

**File:** `packages/ui/src/context/marked.tsx`

```typescript
marked.use(
  {
    renderer: {
      link({ href, title, text }) {
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`
      },
    },
  },
  markedKatex({ throwOnError: false, nonStandard: true }),
  markedShiki({
    async highlight(code, lang) {
      // Uses Shiki for syntax highlighting
      const highlighter = await getSharedHighlighter({ themes: ["OpenCode"], langs: [] })
      return highlighter.codeToHtml(code, { lang, theme: "OpenCode" })
    },
  }),
)
```

### Custom Theme

Defines a custom "OpenCode" theme with CSS variable-based colors:

```typescript
registerCustomTheme("OpenCode", () => ({
  name: "OpenCode",
  colors: {
    "editor.background": "transparent",
    "editor.foreground": "var(--text-base)",
    // ... semantic colors mapped to CSS variables
  },
  tokenColors: [
    { scope: ["comment"], settings: { foreground: "var(--syntax-comment)" } },
    { scope: ["keyword"], settings: { foreground: "var(--syntax-keyword)" } },
    // ... more token colors
  ],
}))
```

### Math Rendering

- **Display math**: `$$...$$` rendered with KaTeX
- **Inline math**: `$...$` rendered with KaTeX
- Math is processed separately from code blocks to avoid conflicts

---

## 6. Code Block Handling

### Markdown Code Blocks

**File:** `packages/ui/src/components/markdown.tsx`

```typescript
// Wraps code blocks with copy button
function ensureWrapper(block: HTMLPreElement) {
  const parent = block.parentElement
  const wrapped = parent?.getAttribute("data-component") === "markdown-code"
  if (wrapped) return
  
  const wrapper = document.createElement("div")
  wrapper.setAttribute("data-component", "markdown-code")
  parent?.replaceChild(wrapper, block)
  wrapper.appendChild(block)
  wrapper.appendChild(createCopyButton(labels))
}
```

### Diff/Code Viewer

**File:** `packages/ui/src/components/code.tsx`

Uses `@pierre/diffs` package for advanced code display:

```typescript
interface CodeProps<T = {}> {
  file: FileContents
  annotations?: LineAnnotation<T>[]
  selectedLines?: SelectedLineRange | null
  commentedLines?: SelectedLineRange[]
  onRendered?: () => void
  onLineSelectionEnd?: (selection: SelectedLineRange | null) => void
  enableLineSelection?: boolean
}
```

Features:
- Line selection (click and drag)
- Line numbers
- Syntax highlighting
- Shadow DOM isolation
- Theme-aware styling

### Tool Output Rendering

Tools that produce output use a consistent pattern:

```typescript
<div data-component="tool-output" data-scrollable>
  <Markdown text={output()} />
</div>
```

The `data-scrollable` attribute marks nested scrollable regions to prevent parent scroll interception.

---

## 7. File Attachment UI

### Image Attachments in Composer

**File:** `packages/app/src/components/prompt-input.tsx`

```typescript
// Supported types
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"]

// Storage as data URL
const addImageAttachment = async (file: File) => {
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result as string
    const attachment: ImageAttachmentPart = {
      type: "image",
      id: crypto.randomUUID(),
      filename: file.name,
      mime: file.type,
      dataUrl,
    }
    prompt.set([...prompt.current(), attachment], cursorPosition)
  }
  reader.readAsDataURL(file)
}
```

### Attachment UI

```
Image Attachments Row
├── Thumbnail (click to preview)
│   ├── Image preview (for images)
│   └── File icon (for PDFs)
├── Filename overlay (bottom)
└── Remove button (top-right, hover)
```

### Context Items (File References)

Separate from image attachments - shows referenced files:

```
Context Item Chip
├── File icon
├── Filename (+ line range if selected)
├── Close button (hover-only)
└── Comment text (if has comment)
```

### Message Attachment Display

**File:** `packages/ui/src/components/message-part.tsx`

In `UserMessageDisplay`:

```typescript
<Show when={attachments().length > 0}>
  <div data-slot="user-message-attachments">
    <For each={attachments()}>
      {(file) => (
        <div
          data-slot="user-message-attachment"
          data-type={file.mime.startsWith("image/") ? "image" : "file"}
          onClick={() => openImagePreview(file.url, file.filename)}
        >
          <img src={file.url} alt={file.filename} />
        </div>
      )}
    </For>
  </div>
</Show>
```

---

## 8. Conversation History Management

### Session Data Structure

**File:** `packages/app/src/context/sync.tsx`

```typescript
// Store structure (per directory)
interface SyncStore {
  message: Record<sessionID, Message[]>
  part: Record<messageID, Part[]>
  session: Session[]
  session_diff: Record<sessionID, FileDiff[]>
  session_status: Record<sessionID, SessionStatus>
  permission: Record<sessionID, PermissionRequest[]>
  question: Record<sessionID, QuestionRequest[]>
  todo: Record<sessionID, Todo[]>
  // ... other data
}
```

### Message Loading Pattern

```typescript
const loadMessages = async (input: {
  directory: string
  client: typeof sdk.client
  setStore: Setter
  sessionID: string
  limit: number
}) => {
  // Prevent duplicate requests
  if (meta.loading[key]) return
  
  setMeta("loading", key, true)
  await retry(() => 
    input.client.session.messages({ sessionID: input.sessionID, limit: input.limit })
  ).then((messages) => {
    // Sort and reconcile with existing
    const next = items
      .map((x) => x.info)
      .filter((m) => !!m?.id)
      .sort((a, b) => a.id.localeCompare(b.id))
    
    batch(() => {
      input.setStore("message", input.sessionID, reconcile(next, { key: "id" }))
      // Also load parts for each message
      for (const message of items) {
        input.setStore("part", message.info.id, reconcile(message.parts, { key: "id" }))
      }
    })
  })
}
```

### Pagination (Load More)

```typescript
history: {
  more(sessionID: string) {
    // Check if there might be more messages
    return !meta.complete[key]
  },
  async loadMore(sessionID: string, count = chunk) {
    const currentLimit = meta.limit[key] ?? chunk
    await loadMessages({
      directory,
      client,
      setStore,
      sessionID,
      limit: currentLimit + count,
    })
  }
}
```

### Optimistic Updates

When sending a message, UI updates immediately before server confirmation:

```typescript
const optimisticMessage: Message = {
  id: messageID,
  sessionID: session.id,
  role: "user",
  time: { created: Date.now() },
  agent,
  model,
}

// Add to store immediately
sync.set(produce((draft) => {
  const messages = draft.message[session.id]
  if (!messages) {
    draft.message[session.id] = [optimisticMessage]
  } else {
    const result = Binary.search(messages, messageID, (m) => m.id)
    messages.splice(result.index, 0, optimisticMessage)
  }
  draft.part[messageID] = optimisticParts
}))
```

### Message Navigation

**File:** `packages/ui/src/components/message-nav.tsx`

Compact vs Normal modes:
- **Compact**: Tick marks with tooltip preview
- **Normal**: Full message list with diff indicators

```typescript
interface MessageNavProps {
  messages: UserMessage[]
  current?: UserMessage
  size: "normal" | "compact"
  onMessageSelect: (message: UserMessage) => void
  getLabel?: (message: UserMessage) => string | undefined
}
```

---

## Key Architectural Patterns

### 1. Registry Pattern
Components register themselves for dynamic rendering:
- `PART_MAPPING` for message parts
- `ToolRegistry` for tool-specific UI

### 2. Reactive Stores
Uses SolidJS stores with reconciliation:
- `reconcile()` for efficient array updates
- `produce()` for immutable updates

### 3. Request Deduplication
Inflight request tracking to prevent duplicates:
```typescript
const inflight = new Map<string, Promise<void>>()
```

### 4. Scroll Gesture Detection
Sophisticated scroll handling for nested scrollables:
- `data-scrollable` attribute marks nested scroll regions
- Wheel/touch event analysis to determine scroll intent

### 5. Content-Editable with Pills
Rich text input without heavy editor libraries:
- Native contenteditable
- Custom "pill" elements for files/agents
- Bidirectional sync with typed data model

---

## File Reference Summary

| File | Purpose |
|------|---------|
| `packages/app/src/pages/session.tsx` | Main session page, message list, layout |
| `packages/app/src/components/prompt-input.tsx` | Composer input with rich features |
| `packages/app/src/context/prompt.tsx` | Prompt state management |
| `packages/app/src/context/sync.tsx` | Session/message data sync |
| `packages/ui/src/components/session-turn.tsx` | Complete turn rendering |
| `packages/ui/src/components/message-part.tsx` | Message and part rendering |
| `packages/ui/src/components/markdown.tsx` | Markdown with copy buttons |
| `packages/ui/src/components/code.tsx` | Code/diff display |
| `packages/ui/src/context/marked.tsx` | Markdown parser configuration |
| `packages/ui/src/hooks/create-auto-scroll.tsx` | Auto-scroll behavior |
