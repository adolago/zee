import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import os from "os"

const app = "agent-core"

function findSourceRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir)
  for (;;) {
    const packageRoot = path.join(current, "packages", "agent-core")
    const agentCoreDir = path.join(current, ".agent-core")
    if (fsSync.existsSync(packageRoot) || fsSync.existsSync(agentCoreDir)) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function resolveSourceRoot(): string {
  const envSource =
    process.env.AGENT_CORE_SOURCE || process.env.OPENCODE_SOURCE || process.env.AGENT_CORE_ROOT
  if (envSource) return envSource

  const starts = [process.cwd()]
  const argvPath = process.argv[1]
  if (argvPath) starts.push(path.dirname(path.resolve(argvPath)))
  starts.push(path.dirname(process.execPath))

  for (const start of starts) {
    const root = findSourceRoot(start)
    if (root) return root
  }

  return process.cwd()
}

// Compute XDG paths dynamically to support test isolation
// Tests set XDG_* env vars in preload.ts, so we must read them at access time
function getXdgDataHome() {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
}
function getXdgCacheHome() {
  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache")
}
function getXdgConfigHome() {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
}
function getXdgStateHome() {
  return process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
}

export namespace Global {
  export const Path = {
    // Allow override for test isolation (AGENT_CORE_TEST_HOME preferred, OPENCODE_TEST_HOME for compat)
    get home() {
      return process.env.AGENT_CORE_TEST_HOME || process.env.OPENCODE_TEST_HOME || os.homedir()
    },
    get source() {
      return resolveSourceRoot()
    },
    get data() {
      return path.join(getXdgDataHome(), app)
    },
    get bin() {
      return path.join(this.data, "bin")
    },
    get log() {
      return path.join(this.data, "log")
    },
    get cache() {
      return path.join(getXdgCacheHome(), app)
    },
    get config() {
      return path.join(getXdgConfigHome(), app)
    },
    get state() {
      return path.join(getXdgStateHome(), app)
    },
    get tmp() {
        return path.join(os.tmpdir(), app)
    },
  }
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
  fs.mkdir(Global.Path.tmp, { recursive: true }),
])

const CACHE_VERSION = "18"

const version = await Bun.file(path.join(Global.Path.cache, "version"))
  .text()
  .catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {
    // Ignore ENOENT (cache dir doesn't exist) - expected on first run
    // Log other errors for debugging
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[agent-core] Cache cleanup failed:", e)
    }
  }
  await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
}
