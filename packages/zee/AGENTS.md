# Zee core agent guidelines

## Build/Test Commands

- **Install**: `bun install`
- **Build**: `bun run build` (compiles binary + updates global symlink)
- **Run**: `bun run --conditions=browser ./src/index.ts`
- **Typecheck**: `bun run typecheck` (npm run typecheck)
- **Test**: `bun test` (runs all tests)
- **Single test**: `bun test test/tool/tool.test.ts` (specific test file)
- **Verify**: `./script/verify-binary.sh` (check binary is correct)

## Binary Installation

The build script automatically symlinks the compiled binary to `~/.bun/bin/zee`:

```bash
# Build outputs to: dist/@zee/zee-linux-x64/bin/zee
# Symlink created: ~/.bun/bin/zee -> <build output>
bun run build
```

After building, restart the daemon to apply changes:

```bash
# Quick reload (no rebuild)
./scripts/reload.sh --no-build

# Full reload (rebuild + restart)
./scripts/reload.sh
```

## Code Style

- **Runtime**: Bun with TypeScript ESM modules
- **Imports**: Use relative imports for local modules, named imports preferred
- **Types**: Zod schemas for validation, TypeScript interfaces for structure
- **Naming**: camelCase for variables/functions, PascalCase for classes/namespaces
- **Error handling**: Use Result patterns, avoid throwing exceptions in tools
- **File structure**: Namespace-based organization (e.g., `Tool.define()`, `Session.create()`)

## Architecture

- **Tools**: Implement `Tool.Info` interface with `execute()` method
- **Context**: Pass `sessionID` in tool context, use `App.provide()` for DI
- **Validation**: All inputs validated with Zod schemas
- **Logging**: Use `Log.create({ service: "name" })` pattern
- **Storage**: Use `Storage` namespace for persistence
- **API Client**: The TypeScript TUI (built with SolidJS + OpenTUI) communicates with the zee server using the SDK. When adding/modifying server endpoints in `packages/zee/src/server/server.ts`, run `./script/generate.ts` to regenerate the SDK and related files.
