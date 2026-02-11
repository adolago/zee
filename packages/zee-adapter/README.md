# OpenCode Adapter

Adapter layer between OpenCode Web UI and Zee daemon. Makes the web UI look and feel identical to the TUI.

## Installation

```bash
bun add @zee/adapter
```

## Quick Start

### 1. Import the TUI theme

In your app's entry point (e.g., `index.css` or `app.tsx`):

```css
/* Option A: Import CSS directly */
@import "@zee/adapter/theme.css";
```

Or in TypeScript/JavaScript:

```typescript
import "@zee/adapter/theme.css"
```

### 2. Wrap your app with ThemeProvider

```tsx
import { ThemeProvider } from "@zee/adapter"

function App() {
  return (
    <ThemeProvider initialMode="tui">
      <YourApp />
    </ThemeProvider>
  )
}
```

### 3. Initialize the adapter

```typescript
import { createAdapter } from "@zee/adapter"

const adapter = createAdapter({
  zeeUrl: "http://127.0.0.1:3210",
  defaultPersona: "zee",
  theme: "tui",
})

await adapter.initialize()

// Create a session
const session = await adapter.session.create({
  workingDirectory: "/path/to/project",
})

// Send a message
const stream = await adapter.session.sendMessage(session.id, {
  role: "user",
  content: "Hello!",
})

for await (const chunk of stream) {
  console.log(chunk.content)
}
```

## Theme Classes

Apply `theme-tui` class or `data-theme="tui"` attribute to enable the TUI look:

```html
<html class="theme-tui">
  <!-- or -->
<html data-theme="tui">
```

## Features

### TUI-Matching Theme

- Monospace fonts (IBM Plex Mono)
- Terminal color scheme (ANSI-based)
- Sharp corners (minimal border-radius)
- Cyan primary/accent colors
- Aesthetic diff highlighting (teal additions, rose deletions)

### Session Bridge

Translates OpenCode sessions to Zee format:

- `create()` - Create new sessions with persona routing
- `get()` - Fetch session by ID
- `list()` - List sessions with filters
- `delete()` - Remove sessions
- `sendMessage()` - Stream messages with SSE

### Tool Bridge

Maps OpenCode tools to Zee equivalents:

| OpenCode Tool | Zee Tool |
|---------------|-----------------|
| BashTool | bash |
| EditTool | edit |
| ReadTool | read |
| GlobTool | glob |
| GrepTool | grep |
| WriteTool | write |
| TaskTool | task |

### Config Bridge

Syncs configuration between systems:

- Model selection
- Persona/agent mapping
- Permission handling
- UI preferences

## Development

```bash
# Build
bun run build

# Watch mode
bun run dev

# Type check
bun run typecheck
```

## Integration with OpenCode

To integrate with the OpenCode web UI at `.wip-surface/opencode/packages/app/`:

1. Add dependency to `packages/app/package.json`:
   ```json
   {
     "dependencies": {
       "@zee/adapter": "workspace:*"
     }
   }
   ```

2. Import theme in `src/index.css`:
   ```css
   @import "@zee/adapter/theme.css";
   ```

3. Wrap App with ThemeProvider in `src/app.tsx`

4. Replace API calls with adapter bridges
