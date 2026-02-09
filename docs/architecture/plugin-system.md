# Plugin System Architecture

## Overview

agent-core supports **runtime plugins** that can:

- register hooks (e.g., chat parameter transforms, tool execution hooks)
- register tools
- provide auth flows for providers

The runtime plugin system is intentionally simple: plugins are loaded, their hook objects are stored, and hook execution is a best-effort loop over loaded plugins.

## Where Things Live

### Plugin Contracts (Public API)

These are the types used by plugin authors and by the runtime loader:

- `packages/zee-core/src/pkg/plugin/index.ts` (exported via `@zee/plugin`)
- `packages/zee-core/src/pkg/plugin/tool.ts` (tool contracts)
- `packages/zee-core/src/pkg/plugin/shell.ts` (Bun shell contracts)

### Runtime Loader (Kernel)

- `packages/zee-core/src/plugin/index.ts`

This module is responsible for:

1. constructing `PluginInput` (SDK client + project context + Bun shell)
2. loading internal plugins (bundled implementations)
3. loading configured plugins (installed via Bun and imported dynamically)
4. executing hooks via `Plugin.trigger(...)`

## Plugin Loading Model

Plugins are loaded in two ways:

1. **Internal plugins** are imported directly from the repo and initialized first.
2. **Configured plugins** are read from config (`config.plugin`) and loaded after.

Configured plugins can be:

- npm packages (`name@version`)
- local file URLs (`file://...`)

## Hook Execution

The runtime exposes a single entrypoint:

- `Plugin.trigger(name, input, output)`

Hook calls are executed sequentially across loaded plugins. Hooks may mutate the provided `output` object.

## Notes

- This document describes the runtime plugin system used by the kernel.
- A separate prototype plugin system previously lived under `src/plugin/`; it is not part of the runtime loader.


# Domain plugins
PLAID_CLIENT_ID=...
PLAID_SECRET=...
ALPHA_VANTAGE_API_KEY=...
WHATSAPP_TOKEN=...
MATRIX_ACCESS_TOKEN=...
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
