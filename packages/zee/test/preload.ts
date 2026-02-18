// IMPORTANT: Set env vars BEFORE any imports from src/ directory
// xdg-basedir reads env vars at import time, so we must set these first
import os from "os"
import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import { threadId } from "worker_threads"
import { afterAll, afterEach } from "bun:test"

const sanitizePathInput = (value: unknown) => (typeof value === "string" ? value.replace(/\0/g, "") : value)
const wrapAsync =
  (fn: (...args: any[]) => any) =>
  (...args: any[]) => {
    if (args.length > 0) args[0] = sanitizePathInput(args[0])
    return fn(...args)
  }
const wrapSync =
  (fn: (...args: any[]) => any) =>
  (...args: any[]) => {
    if (args.length > 0) args[0] = sanitizePathInput(args[0])
    return fn(...args)
  }

for (const name of [
  "open",
  "readFile",
  "writeFile",
  "stat",
  "lstat",
  "access",
  "mkdir",
  "readdir",
  "realpath",
  "rm",
  "cp",
]) {
  const target = (fs as any)[name]
  if (typeof target === "function") {
    ;(fs as any)[name] = wrapAsync(target)
  }
}
const fsPromises = fsSync.promises as any
for (const name of [
  "open",
  "readFile",
  "writeFile",
  "stat",
  "lstat",
  "access",
  "mkdir",
  "readdir",
  "realpath",
  "rm",
  "cp",
]) {
  const target = fsPromises?.[name]
  if (typeof target === "function") {
    fsPromises[name] = wrapAsync(target)
  }
}
for (const name of ["open", "openSync", "readFile", "readFileSync", "writeFile", "writeFileSync", "stat", "statSync"]) {
  const target = (fsSync as any)[name]
  if (typeof target === "function") {
    ;(fsSync as any)[name] = wrapSync(target)
  }
}

const originalBunFile = Bun.file
Bun.file = ((pathLike: any, ...rest: any[]) =>
  originalBunFile(sanitizePathInput(pathLike) as any, ...rest)) as typeof Bun.file

const originalBunWrite = Bun.write
Bun.write = ((pathLike: any, data: any, ...rest: any[]) =>
  originalBunWrite(sanitizePathInput(pathLike) as any, data, ...rest)) as typeof Bun.write

const hasNullByte = (value: unknown) => typeof value === "string" && value.includes("\0")
const shouldIgnoreNullBytePathError = (error: unknown) => {
  if (!error || typeof error !== "object") return false
  const code = (error as any).code
  const pathValue = (error as any).path
  const message = (error as any).message
  return code === "ENOENT" && (hasNullByte(pathValue) || hasNullByte(message))
}
const wrapOpenAsync =
  (fn: (...args: any[]) => Promise<any>) =>
  async (...args: any[]) => {
    if (args.length > 0) args[0] = sanitizePathInput(args[0])
    try {
      return await fn(...args)
    } catch (error) {
      if (!shouldIgnoreNullBytePathError(error)) throw error
      const fallbackArgs = [...args]
      fallbackArgs[0] = "/dev/null"
      if (fallbackArgs.length === 1) fallbackArgs.push("r")
      return await fn(...fallbackArgs)
    }
  }
const wrapOpenSync =
  (fn: (...args: any[]) => any) =>
  (...args: any[]) => {
    if (args.length > 0) args[0] = sanitizePathInput(args[0])
    try {
      return fn(...args)
    } catch (error) {
      if (!shouldIgnoreNullBytePathError(error)) throw error
      const fallbackArgs = [...args]
      fallbackArgs[0] = "/dev/null"
      if (fallbackArgs.length === 1) fallbackArgs.push("r")
      return fn(...fallbackArgs)
    }
  }
const rethrowUnhandled = (reason: unknown) => {
  const error = reason instanceof Error ? reason : new Error(String(reason))
  queueMicrotask(() => {
    throw error
  })
}

process.on("uncaughtException", (error) => {
  if (shouldIgnoreNullBytePathError(error)) return
  rethrowUnhandled(error)
})
process.on("unhandledRejection", (reason) => {
  if (shouldIgnoreNullBytePathError(reason)) return
  rethrowUnhandled(reason)
})

const fsPromisesOpen = (fs as any).open
if (typeof fsPromisesOpen === "function") {
  ;(fs as any).open = wrapOpenAsync(fsPromisesOpen)
}
const fsSyncPromisesOpen = fsPromises?.open
if (typeof fsSyncPromisesOpen === "function") {
  fsPromises.open = wrapOpenAsync(fsSyncPromisesOpen)
}
if (typeof fsSync.openSync === "function") {
  fsSync.openSync = wrapOpenSync(fsSync.openSync)
}

// bun test preloads this file per test file; bun may execute multiple test files in parallel on worker threads.
// Use a per-thread directory to avoid cross-file collisions and premature deletion by afterAll().
const dir = path.join(os.tmpdir(), `zee-test-data-${process.pid}-${threadId}`)
await fs.mkdir(dir, { recursive: true })
afterAll(() => {
  fsSync.rmSync(dir, { recursive: true, force: true })
})
// Set test home directory to isolate tests from user's actual home directory
// This prevents tests from picking up real user configs/skills from ~/.claude/skills
const testHome = path.join(dir, "home")
await fs.mkdir(testHome, { recursive: true })
process.env["ZEE_TEST_HOME"] = testHome
// Set test managed config directory to isolate tests from system managed settings
const testManagedConfigDir = path.join(dir, "managed")
process.env["ZEE_TEST_MANAGED_CONFIG_DIR"] = testManagedConfigDir

process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")

await Promise.all([
  fs.mkdir(path.join(dir, "share", "zee"), { recursive: true }),
  fs.mkdir(path.join(dir, "cache", "zee"), { recursive: true }),
  fs.mkdir(path.join(dir, "config", "zee"), { recursive: true }),
  fs.mkdir(path.join(dir, "state", "zee"), { recursive: true }),
])

const managedConfigDir = path.join(dir, "managed-config")
process.env["ZEE_TEST_MANAGED_CONFIG_DIR"] = managedConfigDir

// Server auth breaks most unit tests (they don't send Authorization headers).
process.env["ZEE_DISABLE_SERVER_AUTH"] = "true"

// Pre-fetch models.json so tests don't need the macro fallback
// Also write the cache version file to prevent global/index.ts from clearing the cache
const cacheDir = path.join(dir, "cache", "zee")
await fs.mkdir(cacheDir, { recursive: true })
await fs.writeFile(path.join(cacheDir, "version"), "18")
const { Global } = await import("../src/global")
const modelsDevUrl = Global.Path.modelsDevUrl
const response = await fetch(`${modelsDevUrl}/api.json`)
if (response.ok) {
  await fs.writeFile(path.join(cacheDir, "models.json"), await response.text())
} else {
  console.error(`[preload] Failed to fetch models.dev: ${response.status}`)
}
// Disable models.dev refresh to avoid race conditions during tests
process.env["ZEE_DISABLE_MODELS_FETCH"] = "true"

// Clear config override env vars to ensure clean test state
// These flags can override project config and interfere with permission tests
delete process.env["ZEE_PERMISSION"]
delete process.env["ZEE_CONFIG"]
delete process.env["ZEE_CONFIG_CONTENT"]
delete process.env["ZEE_CONFIG_DIR"]

// Clear provider env vars to ensure clean test state
delete process.env["ANTHROPIC_API_KEY"]
delete process.env["OPENAI_API_KEY"]
delete process.env["GOOGLE_API_KEY"]
delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"]
delete process.env["AZURE_OPENAI_API_KEY"]
delete process.env["AWS_ACCESS_KEY_ID"]
delete process.env["AWS_PROFILE"]
delete process.env["AWS_REGION"]
delete process.env["AWS_BEARER_TOKEN_BEDROCK"]
delete process.env["OPENROUTER_API_KEY"]
delete process.env["GROQ_API_KEY"]
delete process.env["MISTRAL_API_KEY"]
delete process.env["PERPLEXITY_API_KEY"]
delete process.env["TOGETHER_API_KEY"]
delete process.env["XAI_API_KEY"]
delete process.env["DEEPSEEK_API_KEY"]
delete process.env["FIREWORKS_API_KEY"]
delete process.env["SAMBANOVA_API_KEY"]

// Now safe to import from src/
const { Log } = await import("../src/util/log")
const { Instance } = await import("../src/project/instance")
const { State } = await import("../src/project/state")
const { Config } = await import("../src/config/config")
const { GlobalBus } = await import("../src/bus/global")
const { Scheduler } = await import("../src/scheduler")
const { ProcessRegistry } = await import("../src/process/registry")
const { ServerState } = await import("../src/server/state")
const { CircuitBreaker } = await import("../src/provider/circuit-breaker")
const { ModelEquivalence } = await import("../src/provider/equivalence")
const { Storage } = await import("../src/storage/storage")
const { parser: bashParser } = await import("../src/tool/bash")
const { Ripgrep } = await import("../src/file/ripgrep")

Log.init({
  print: false,
  dev: true,
  level: "DEBUG",
})

// Clean up global state between tests to prevent state pollution
afterEach(async () => {
  try {
    await fs.rm(managedConfigDir, { force: true, recursive: true }).catch(() => {})

    // 1. Dispose all Instance contexts and their associated State
    await Instance.disposeAll()

    // 2. Clear any remaining State entries not tied to Instance
    State.clear()

    // 3. Reset Config.global lazy cache
    Config.global.reset()

    // 4. Clear GlobalBus listeners to prevent cross-test event handling
    GlobalBus.removeAllListeners()

    // 5. Clear Scheduler global registry
    Scheduler.resetGlobal()

    // 6. Shutdown ProcessRegistry singleton
    ProcessRegistry.getInstance().shutdown()

    // 7. Reset ServerState URL
    ServerState.reset()

    // 8. Reset CircuitBreaker state
    await CircuitBreaker.resetAll()

    // 9. Reset ModelEquivalence tier configuration
    ModelEquivalence.reset()

    // 10. Reset Storage lazy cache (prevents cross-test state pollution)
    Storage.state.reset()

    // 11. Reset Server state (Hono app instance + network-derived globals)
    const { Server } = await import("../src/server/server")
    Server.reset()

    // 12. Reset Bash parser lazy cache (tree-sitter)
    bashParser.reset()

    // 13. Reset Ripgrep state lazy cache
    Ripgrep.state.reset()
  } catch (error) {
    if (!shouldIgnoreNullBytePathError(error)) throw error
  }
})
