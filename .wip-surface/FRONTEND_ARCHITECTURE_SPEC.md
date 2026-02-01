# OpenCode Web UI - Frontend Architecture Specification

**Repository:** `/home/artur/.local/src/agent-core/.wip-surface/opencode/`  
**Version:** 1.1.48  
**Date:** February 2026

---

## 1. Technology Stack

### 1.1 Core Framework
| Technology | Version | Purpose |
|------------|---------|---------|
| **SolidJS** | 1.9.10 | Reactive UI framework (primary) |
| **TypeScript** | 5.8.2 | Type-safe development |
| **Vite** | 7.1.4 | Build tool and dev server |

### 1.2 Routing & Meta
| Technology | Version | Purpose |
|------------|---------|---------|
| **@solidjs/router** | 0.15.4 | Client-side routing |
| **@solidjs/meta** | 0.29.4 | Document head management |

### 1.3 Styling
| Technology | Version | Purpose |
|------------|---------|---------|
| **TailwindCSS** | 4.1.11 | Utility-first CSS framework |
| **@tailwindcss/vite** | 4.1.11 | Vite integration for Tailwind |

### 1.4 UI Components & Primitives
| Technology | Version | Purpose |
|------------|---------|---------|
| **@kobalte/core** | 0.13.11 | Headless UI primitives |
| **@thisbeyond/solid-dnd** | 0.7.5 | Drag and drop support |

### 1.5 State Management
| Technology | Version | Purpose |
|------------|---------|---------|
| **solid-js/store** | Built-in | Reactive stores |
| **@solid-primitives/storage** | 4.3.3 | Persistent storage |
| **@solid-primitives/event-bus** | 1.1.2 | Event communication |

### 1.6 Backend Integration
| Technology | Version | Purpose |
|------------|---------|---------|
| **@opencode-ai/sdk** | Workspace | Auto-generated API client |
| **@solid-primitives/websocket** | 1.3.1 | Real-time communication |

### 1.7 Utilities
| Technology | Version | Purpose |
|------------|---------|---------|
| **luxon** | 3.6.1 | Date/time handling |
| **marked** | 17.0.1 | Markdown parsing |
| **shiki** | 3.20.0 | Syntax highlighting |
| **zod** | 4.1.8 | Schema validation |
| **remeda** | 2.26.0 | Functional utilities |
| **virtua** | 0.42.3 | Virtual scrolling |
| **fuzzysort** | 3.1.0 | Fuzzy search |
| **diff** | 8.0.2 | Text diffing |

---

## 2. Application Structure

### 2.1 Monorepo Layout
```
opencode/
├── packages/
│   ├── app/              # Main web application
│   ├── ui/               # Shared UI component library
│   ├── sdk/js/           # Auto-generated API client
│   ├── opencode/         # Core backend/CLI
│   ├── console/          # Console/web dashboard
│   ├── containers/       # Container management
│   ├── desktop/          # Desktop app (Tauri)
│   └── ...
├── infra/                # SST infrastructure
├── github/               # GitHub integration
└── sdks/vscode/          # VSCode extension
```

### 2.2 App Package Structure (`packages/app/`)
```
src/
├── app.tsx               # Main app component with providers
├── entry.tsx             # Application entry point
├── index.css             # Global styles (imports UI tailwind)
├── index.ts              # Package exports
├── pages/                # Page components
│   ├── home.tsx          # Landing/project selection
│   ├── session.tsx       # Chat session interface
│   ├── layout.tsx        # Main layout shell
│   ├── directory-layout.tsx  # Directory-scoped layout
│   └── error.tsx         # Error boundary page
├── context/              # React/Solid contexts
│   ├── global-sdk.tsx    # Global SDK client
│   ├── global-sync.tsx   # Data synchronization
│   ├── server.tsx        # Server connection management
│   ├── layout.tsx        # UI layout state
│   ├── settings.tsx      # User settings
│   ├── terminal.tsx      # Terminal integration
│   ├── file.tsx          # File management
│   ├── prompt.tsx        # Prompt handling
│   ├── models.tsx        # AI models state
│   ├── command.tsx       # Command palette
│   ├── language.tsx      # i18n
│   └── ...
├── components/           # App-specific components
├── hooks/                # Custom Solid primitives
├── utils/                # Utility functions
└── i18n/                 # Translation files
```

### 2.3 UI Package Structure (`packages/ui/`)
```
src/
├── components/           # Reusable UI components
│   ├── button.tsx
│   ├── dialog.tsx
│   ├── dropdown-menu.tsx
│   ├── markdown.tsx
│   ├── message-part.tsx
│   ├── session-turn.tsx
│   ├── diff.tsx
│   ├── code.tsx
│   └── ... (50+ components)
├── context/              # UI contexts
│   ├── helper.tsx        # createSimpleContext utility
│   ├── data.ts           # Data contexts
│   ├── diff.tsx          # Diff context
│   ├── dialog.tsx        # Dialog management
│   └── i18n.ts           # i18n context
├── hooks/                # UI hooks
├── theme/                # Theming system
│   ├── index.ts          # Theme exports
│   ├── context.tsx       # ThemeProvider
│   ├── types.ts          # Theme types
│   ├── color.ts          # Color utilities
│   ├── resolve.ts        # Theme resolution
│   ├── loader.ts         # Theme loading
│   └── default-themes.ts # Built-in themes
├── styles/               # Component styles
│   ├── index.css         # Main stylesheet
│   ├── colors.css        # Color definitions
│   ├── theme.css         # Theme variables
│   ├── base.css          # Base styles
│   ├── utilities.css     # Utilities
│   └── animations.css    # Animations
└── assets/               # Static assets
    ├── fonts/            # Nerd Fonts (Geist, Fira, etc.)
    ├── icons/            # SVG icons
    └── audio/            # Sound effects
```

---

## 3. State Management

### 3.1 Global State Architecture

The application uses a **multi-layered state management** approach:

```
┌─────────────────────────────────────────────────────────────┐
│                    GlobalSync Provider                       │
│         (Central data synchronization layer)                 │
├─────────────────────────────────────────────────────────────┤
│  Global State:                                              │
│  • Projects list                                           │
│  • Providers configuration                                 │
│  • Server configuration                                    │
│  • Paths                                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Per-Directory State                          │
│          (Created dynamically per workspace)                 │
├─────────────────────────────────────────────────────────────┤
│  • Sessions (filtered/paginated)                           │
│  • Messages (by session)                                   │
│  • Parts (by message)                                      │
│  • Agents, Commands, Config                                │
│  • Permissions, Questions, Todos                           │
│  • VCS info, LSP status, MCP status                        │
│  • Session diffs                                           │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Key Contexts

#### ServerContext (`context/server.tsx`)
- Manages server connections
- Health checking (10s interval)
- Project list per server
- Server URL normalization
- Persistent via `@solid-primitives/storage`

#### GlobalSDKContext (`context/global-sdk.tsx`)
- Creates API client instance
- Manages global event stream
- Event coalescing for performance (16ms batching)
- Provides typed SDK client via `@opencode-ai/sdk`

#### GlobalSyncContext (`context/global-sync.tsx`)
- **1000+ lines** - Core synchronization logic
- Handles real-time updates via SSE/WebSocket events
- Manages store reconciliation
- Implements session pagination (default limit: 5)
- Session retention policy: 4-hour window, max 50 recent

#### LayoutContext (`context/layout.tsx`)
- Sidebar state
- Panel configurations
- Project expansion states

### 3.3 Store Patterns

Uses **SolidJS Stores** with `createStore` and `produce` for immutable updates:

```typescript
// Pattern: Nested store with directory keying
const [store, setStore] = createStore<State>({
  session: {},      // keyed by directory
  message: {},      // keyed by sessionID
  part: {},         // keyed by messageID
  permission: {},   // keyed by sessionID
})

// Updates use reconcile for efficient array updates
setStore(
  "session", 
  directory, 
  reconcile(sessions, { key: "id" })
)
```

### 3.4 Persistence

Uses custom `persisted` utility with versioned storage keys:

```typescript
// Pattern from context/server.tsx
const [store, setStore, _, ready] = persisted(
  Persist.global("server", ["server.v3"]),
  createStore({
    list: [] as string[],
    projects: {} as Record<string, StoredProject[]>,
  })
)
```

---

## 4. Routing System

### 4.1 Router Configuration (`app.tsx`)

```typescript
<Router
  root={(props) => (
    <SettingsProvider>
      <PermissionProvider>
        <LayoutProvider>
          <NotificationProvider>
            <ModelsProvider>
              <CommandProvider>
                <HighlightsProvider>
                  <Layout>{props.children}</Layout>
                </HighlightsProvider>
              </CommandProvider>
            </ModelsProvider>
          </NotificationProvider>
        </LayoutProvider>
      </PermissionProvider>
    </SettingsProvider>
  )}
>
  <Route path="/" component={Home} />
  <Route path="/:dir" component={DirectoryLayout}>
    <Route path="/" component={() => <Navigate href="session" />} />
    <Route path="/session/:id?" component={Session} />
  </Route>
</Router>
```

### 4.2 Route Structure

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `Home` | Project selection, server switcher |
| `/:dir` | `DirectoryLayout` | Workspace-scoped layout |
| `/:dir/session` | `Session` | New session (no ID) |
| `/:dir/session/:id` | `Session` | Existing session |

### 4.3 Directory Encoding

Directory paths are **base64-encoded** in URLs:

```typescript
// From home.tsx
navigate(`/${base64Encode(directory)}`)
```

---

## 5. Component Patterns

### 5.1 Component Conventions

- **File naming**: PascalCase (e.g., `session-turn.tsx`)
- **Component naming**: PascalCase matching filename
- **Style files**: Same name with `.css` extension
- **Barrel exports**: Direct exports from `components/` folder

### 5.2 Provider/Context Pattern

Uses custom `createSimpleContext` helper:

```typescript
// From ui/src/context/helper.tsx
export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: (props: { defaultUrl: string }) => {
    // initialization logic
    return { url, healthy, list, add, remove }
  }
})
```

### 5.3 Component Composition

Components follow **composition patterns** with Kobalte primitives:

```typescript
// Example: Dialog composition
import * as Dialog from "@kobalte/core/dialog"

export function MyDialog() {
  return (
    <Dialog.Root>
      <Dialog.Trigger>Open</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Title</Dialog.Title>
          <Dialog.Description>Description</Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

### 5.4 Key UI Components

| Component | Purpose | Location |
|-----------|---------|----------|
| `message-part.tsx` | Renders message content parts | `ui/src/components/` |
| `session-turn.tsx` | Chat message turn display | `ui/src/components/` |
| `diff.tsx` | Code diff visualization | `ui/src/components/` |
| `code.tsx` | Syntax-highlighted code blocks | `ui/src/components/` |
| `markdown.tsx` | Markdown rendering with Shiki | `ui/src/components/` |
| `file-icon.tsx` | File type icons (900+ types) | `ui/src/components/` |
| `provider-icon.tsx` | AI provider logos | `ui/src/components/` |

---

## 6. Styling Architecture

### 6.1 Layer Organization (`ui/src/styles/index.css`)

```css
@layer theme, base, components, utilities;

/* Theme Layer */
@import "./colors.css" layer(theme);
@import "./theme.css" layer(theme);

/* Base Layer */
@import "./base.css" layer(base);
@import "katex/dist/katex.min.css" layer(base);

/* Components Layer */
@import "../components/button.css" layer(components);
@import "../components/dialog.css" layer(components);
/* ... 50+ component styles */

/* Utilities Layer */
@import "./utilities.css" layer(utilities);
@import "./animations.css" layer(utilities);
```

### 6.2 CSS Custom Properties

Uses **OKLCH color space** for theming:

```css
/* Example from theme system */
:root {
  --color-primary-1: oklch(99% 0.01 250);
  --color-primary-2: oklch(95% 0.02 250);
  /* ... scale of 12 */
  --background-base: var(--color-neutral-1);
  --text-strong: var(--color-neutral-12);
  --text-weak: var(--color-neutral-11);
}
```

### 6.3 Typography Scale

Uses **Geist** font family with monospace variants:

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `text-12-regular` | 12px | 400 | Body small |
| `text-14-regular` | 14px | 400 | Body |
| `text-14-medium` | 14px | 500 | Emphasis |
| `text-14-mono` | 14px | 400 | Code paths |

### 6.4 Built-in Themes

Located in `ui/src/theme/default-themes.ts`:

- `oc1Theme` - Default OpenCode theme
- `tokyonightTheme`
- `draculaTheme`
- `monokaiTheme`
- `solarizedTheme`
- `nordTheme`
- `catppuccinTheme`
- `ayuTheme`
- `oneDarkProTheme`
- `shadesOfPurpleTheme`
- `nightowlTheme`
- `vesperTheme`

---

## 7. Build Configuration

### 7.1 Vite Config (`packages/app/vite.config.ts`)

```typescript
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  plugins: [desktopPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
  },
})
```

### 7.2 Vite Plugin (`packages/app/vite.js`)

```typescript
export default [
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  tailwindcss(),
  solidPlugin(),
]
```

### 7.3 UI Package Vite Config

```typescript
export default defineConfig({
  plugins: [
    solidPlugin(),
    providerIconsPlugin(),  // Fetches provider logos
    iconsSpritesheet([      // Generates icon components
      {
        inputDir: "src/assets/icons/file-types",
        outputDir: "src/components/file-icons",
      },
      {
        inputDir: "src/assets/icons/provider",
        outputDir: "src/components/provider-icons",
      },
    ]),
  ],
  server: { port: 3001 },
  build: { target: "esnext" },
  worker: { format: "es" },
})
```

### 7.4 Build Commands

```bash
# Development
bun dev              # Start dev server (packages/opencode)
bun start            # Start app dev server (packages/app)

# Production
bun run build        # Build for production
bun run typecheck    # Type checking

# Testing
bun run test:e2e     # Playwright E2E tests
bun run test:e2e:ui  # Playwright with UI
```

### 7.5 Package Manager

- **Bun** 1.3.5 (specified in `packageManager`)
- Workspace configuration in root `package.json`
- Catalog versions for shared dependencies

---

## 8. Integration Points with Backend

### 8.1 SDK Generation

The SDK is **auto-generated from OpenAPI spec**:

```
packages/sdk/
├── openapi.json          # OpenAPI specification
└── js/
    ├── script/build.ts   # Generation script
    └── src/
        ├── v2/client.ts  # Generated client
        └── v2/server.ts  # Generated server types
```

Uses `@hey-api/openapi-ts` for generation.

### 8.2 API Client Pattern

```typescript
// From global-sdk.tsx
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

const client = createOpencodeClient({
  baseUrl: server.url,
  fetch: platform.fetch,
  throwOnError: true,
})
```

### 8.3 Real-time Events

Uses **Server-Sent Events** for real-time updates:

```typescript
// Event stream connection
const events = await eventSdk.global.event()
for await (const event of events.stream) {
  const directory = event.directory ?? "global"
  const payload = event.payload
  emitter.emit(directory, payload)
}
```

### 8.4 Event Types

Handled in `global-sync.tsx`:

| Event | Description |
|-------|-------------|
| `session.created` | New session created |
| `session.updated` | Session metadata updated |
| `session.deleted` | Session removed |
| `session.diff` | File diff updated |
| `session.status` | Session execution status |
| `message.updated` | Message content updated |
| `message.part.updated` | Message part (stream) updated |
| `todo.updated` | Todo list updated |
| `permission.asked` | User permission requested |
| `question.asked` | User question requested |
| `vcs.branch.updated` | Git branch changed |
| `lsp.updated` | LSP status changed |

### 8.5 Server Configuration

Default server detection (from `app.tsx`):

```typescript
const defaultServerUrl = () => {
  if (props.defaultUrl) return props.defaultUrl
  if (stored) return stored
  if (location.hostname.includes("opencode.ai")) 
    return "http://localhost:4096"
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  return window.location.origin
}
```

### 8.6 Platform Abstraction

`Platform` interface abstracts web vs desktop:

```typescript
interface Platform {
  platform: "web" | "desktop" | "vscode"
  version: string
  openLink(url: string): void
  back(): void
  forward(): void
  restart(): Promise<void>
  notify(title, description, href?): Promise<void>
  openDirectoryPickerDialog?(options): Promise<string | string[] | null>
  parseMarkdown?(markdown: string): string
  fetch?: typeof fetch
}
```

---

## 9. Key Integration Notes for agent-core

### 9.1 Reusable Components

Components suitable for adaptation:

1. **Message rendering** - `message-part.tsx`, `session-turn.tsx`
2. **Code display** - `code.tsx`, `diff.tsx`
3. **Markdown** - `markdown.tsx` (uses Shiki + marked)
4. **File icons** - `file-icon.tsx` (900+ file types)
5. **UI primitives** - Button, Dialog, Dropdown, etc.

### 9.2 State Patterns

Recommended patterns from OpenCode:

1. **Event-driven sync** - Global event emitter + store reconciliation
2. **Directory-scoped state** - Isolated state per workspace
3. **Optimistic pagination** - Session list with "load more"
4. **Persistent caching** - Versioned localStorage keys

### 9.3 Styling Considerations

- OKLCH color space for perceptually uniform theming
- CSS cascade layers for style isolation
- Component-scoped CSS files
- Tailwind 4 with CSS-first configuration

### 9.4 Build Integration

Requirements:
- Vite 7+ with `vite-plugin-solid`
- TailwindCSS 4 with `@tailwindcss/vite`
- TypeScript 5.8+
- Bun for package management

---

## Appendix: File Counts

| Package | TSX/TS Files | Key Directories |
|---------|--------------|-----------------|
| `packages/app` | ~50 | `src/pages/`, `src/context/` |
| `packages/ui` | ~70 | `src/components/`, `src/theme/` |
| `packages/sdk/js` | ~10 | `src/v2/` |

---

*Document generated for agent-core integration planning.*
