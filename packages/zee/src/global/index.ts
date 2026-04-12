import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import os from "os"
import {
  resolveCacheDir,
  resolveConfigDir,
  resolveDataDir,
  resolveInstallRoot,
  resolveLogsDir,
  resolvePolicyPath,
  resolveStateDir,
  resolveWorkspaceDir,
} from "./dirs"

const app = "zee"

function findSourceRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir)
  for (;;) {
    const packageRoot = path.join(current, "packages", "zee")
    const zeeDir = path.join(current, ".zee")
    if (fsSync.existsSync(packageRoot) || fsSync.existsSync(zeeDir)) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function resolveSourceRoot(): string {
  const envSource = process.env.ZEE_SOURCE || process.env.ZEE_ROOT
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

export namespace Global {
  export const Path = {
    // Allow override for test isolation via ZEE_TEST_HOME.
    get home() {
      return process.env.ZEE_TEST_HOME || os.homedir()
    },
    get source() {
      return resolveSourceRoot()
    },
    get data() {
      return resolveDataDir()
    },
    get bin() {
      return path.join(this.data, "bin")
    },
    get log() {
      return process.platform === "win32" ? resolveLogsDir() : path.join(this.data, "log")
    },
    get logs() {
      return resolveLogsDir()
    },
    get cache() {
      return resolveCacheDir()
    },
    get config() {
      return resolveConfigDir()
    },
    get state() {
      return resolveStateDir()
    },
    get workspace() {
      return resolveWorkspaceDir()
    },
    get policy() {
      return resolvePolicyPath()
    },
    get installRoot() {
      return resolveInstallRoot()
    },
    get tmp() {
      return path.join(os.tmpdir(), app)
    },
    get modelsDevUrl() {
      return process.env.ZEE_MODELS_URL || process.env.AGENT_CORE_MODELS_URL || "https://models.dev"
    },
  }
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.cache, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
  fs.mkdir(Global.Path.tmp, { recursive: true }),
])

async function seedFileIfMissing(source: string, destination: string): Promise<void> {
  try {
    await fs.access(destination, fsSync.constants.F_OK)
    return
  } catch {
    // destination missing
  }

  try {
    await fs.access(source, fsSync.constants.F_OK)
  } catch {
    // source missing; skip silently so local dev without assets still works
    return
  }

  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.copyFile(source, destination)
}

const identityAssetsDir = path.join(Global.Path.source, ".zee", "identity")
await Promise.all([
  seedFileIfMissing(path.join(identityAssetsDir, "IDENTITY.md"), path.join(Global.Path.config, "IDENTITY.md")),
  seedFileIfMissing(path.join(identityAssetsDir, "SOUL.md"), path.join(Global.Path.config, "SOUL.md")),
])

const CACHE_VERSION = "18"

const cacheVersionPath = path.join(Global.Path.cache, "version")
const version = await fs.readFile(cacheVersionPath, "utf-8").catch(() => "0")

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
      console.error("[zee] Cache cleanup failed:", e)
    }
  }
  await fs.writeFile(cacheVersionPath, CACHE_VERSION, "utf-8")
}
