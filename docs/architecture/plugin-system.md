# Plugin System Architecture

## Overview

The plugin system provides the extensibility layer for agent-core, enabling plugins to extend agent functionality through hooks, tools, and authentication providers. The design supports agent-specific use cases.

## Architecture Diagram

```
+------------------------------------------------------------------+
|                         Plugin System                             |
+------------------------------------------------------------------+
|                                                                   |
|  +-------------------+    +-------------------+                   |
|  |   PluginSystem    |    |    HookManager    |                   |
|  |      Facade       |--->|                   |                   |
|  +-------------------+    +-------------------+                   |
|           |                        |                              |
|           v                        v                              |
|  +-------------------+    +-------------------+                   |
|  |   PluginLoader    |    |  Registered Hooks |                   |
|  |                   |    |  (by hook name)   |                   |
|  +-------------------+    +-------------------+                   |
|           |                                                       |
|           v                                                       |
|  +-------------------+    +-------------------+                   |
|  |  Plugin Sources   |    |   Built-in        |                   |
|  |  - NPM packages   |    |   Plugins         |                   |
|  |  - Local files    |    |   - anthropic-auth|                   |
|  |  - Built-in       |    |   - copilot-auth  |                   |
|  +-------------------+    |   - memory        |                   |
|                           +-------------------+                   |
|                                    |                              |
|                                    v                              |
|                           +-------------------+                   |
|                           | Domain Plugins    |                   |
|                           | - stanley-finance |                   |
|                           | - zee-messaging   |                   |
|                           +-------------------+                   |
+------------------------------------------------------------------+
```

## Core Components

### 1. Plugin Interface (`plugin.ts`)

Defines the core types and interfaces for plugins:

- **PluginFactory**: Function that creates a plugin instance
- **PluginInstance**: The plugin object with hooks, tools, and auth
- **PluginContext**: Context provided to plugins during initialization
- **Hooks**: All available hook types
- **ToolDefinition**: Tool registration format
- **AuthProvider**: Authentication provider interface

### 2. Hook Manager (`hooks.ts`)

Manages hook registration and execution:

- **RegisteredHook**: Hook with metadata (plugin name, priority, enabled)
- **HookManager**: Central coordinator for hook invocations
- **Hook Types**: Predefined hook type constants
- **Hook Decorators**: `@Hook` decorator for class-based plugins

### 3. Plugin Loader (`loader.ts`)

Handles plugin loading from various sources:

- **NPM packages**: `package-name@version`
- **Local files**: `file://path` or `./relative/path`
- **Built-in**: `builtin:plugin-name`

### 4. Built-in Plugins

#### Core Plugins
- **anthropic-auth**: Anthropic API authentication
- **copilot-auth**: GitHub Copilot authentication
- **memory-persistence**: Persistent memory storage

#### Domain Plugins
- **stanley-finance**: Financial data tools for Stanley
- **zee-messaging**: Messaging platform tools for Zee

## Hook Types

### Session Lifecycle
```typescript
'session.start'   // Session begins
'session.end'     // Session ends
'session.restore' // Session restored from persistence
```

### Task Lifecycle
```typescript
'pre-task'  // Before task execution
'post-task' // After task completion
```

### File Operations
```typescript
'pre-edit'  // Before file edit
'post-edit' // After file edit
```

### Chat/Messaging
```typescript
'chat.message'  // New user message received
'chat.params'   // Modify LLM parameters
'chat.response' // Assistant response received
```

### Tool Execution
```typescript
'tool.execute.before' // Before tool execution
'tool.execute.after'  // After tool execution
```

### Permissions
```typescript
'permission.ask' // Permission requested
```

### Memory
```typescript
'memory.update'   // Memory updated
'memory.retrieve' // Memory retrieved
```

## Plugin Lifecycle

```
1. Load Phase
   - Plugin source resolved (NPM, file, builtin)
   - Module imported
   - Factory function called with PluginContext

2. Init Phase
   - lifecycle.init() called
   - Hooks registered with HookManager
   - Tools and auth providers registered

3. Active Phase
   - Hooks triggered on events
   - Tools available for execution
   - Auth providers available

4. Destroy Phase
   - lifecycle.destroy() called
   - Hooks unregistered
   - Resources cleaned up
```

## Usage Examples

### Basic Plugin System Setup

```typescript
import { createPluginSystem, PluginContext } from './plugin';

const pluginSystem = createPluginSystem({
  agentId: 'stanley',
  disableDefaults: false,
});

const context: PluginContext = {
  instanceId: 'inst-123',
  workDir: process.cwd(),
  projectRoot: '/path/to/project',
  shell: createShell(),
  config: createConfig(),
  logger: createLogger(),
  events: createEventBus(),
};

await pluginSystem.init(context);
```

### Triggering Hooks

```typescript
// Trigger with output transformation
const output = await pluginSystem.trigger(
  'chat.message',
  { sessionId: 'sess-1', agentId: 'stanley' },
  { message: userMessage, parts: [] }
);

// Notify without output transformation
await pluginSystem.notify(
  'session.start',
  { sessionId: 'sess-1' },
  { context: {} }
);
```

### Creating a Custom Plugin

```typescript
import { PluginFactory, defineTool, schema as z } from './plugin';

export const MyPlugin: PluginFactory = async (ctx) => {
  return {
    metadata: {
      name: 'my-plugin',
      version: '1.0.0',
    },

    lifecycle: {
      async init() {
        ctx.logger.info('My plugin initialized');
      },
      async destroy() {
        ctx.logger.info('My plugin destroyed');
      },
    },

    hooks: {
      'chat.message': async (input, output) => {
        // Modify the message
        return {
          ...output,
          parts: [...output.parts, { type: 'text', content: 'Enhanced!' }],
        };
      },
    },

    tools: {
      my_tool: defineTool({
        description: 'My custom tool',
        args: {
          input: z.string().describe('Input text'),
        },
        async execute(args) {
          return `Processed: ${args.input}`;
        },
      }),
    },
  };
};
```

## Configuration

### Plugin Descriptors

```typescript
interface PluginDescriptor {
  source: string;      // NPM package, file path, or builtin
  enabled?: boolean;   // Whether plugin is enabled
  config?: Record<string, unknown>; // Plugin-specific config
}
```

### Environment Variables

```bash
# Auth plugins
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...

# Domain plugins
PLAID_CLIENT_ID=...
PLAID_SECRET=...
ALPHA_VANTAGE_API_KEY=...
WHATSAPP_TOKEN=...
TELEGRAM_BOT_TOKEN=...
```

## Security Considerations

1. **Plugin Sandboxing**: Plugins run in the same process but should be isolated from sensitive operations
2. **Secret Management**: Never hardcode secrets; use environment variables
3. **Permission System**: Hooks can control permissions via `permission.ask` hook
4. **Input Validation**: Tool arguments validated via Zod schemas

## Future Enhancements

1. **Plugin Sandboxing**: Run plugins in isolated contexts
2. **Hot Reloading**: Reload plugins without restart
3. **Plugin Registry**: Central registry for discovering plugins
4. **Dependency Resolution**: Automatic dependency ordering
5. **Plugin Versioning**: Version compatibility checking
