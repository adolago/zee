import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire a free port")))
        return
      }
      server.close((err) => {
        if (err) {
          reject(err)
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function waitForHealth(url: string) {
  const timeout = Date.now() + 120_000
  const errors: string[] = []
  while (Date.now() < timeout) {
    const result = await fetch(url)
      .then((r) => ({ ok: r.ok, error: undefined }))
      .catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    if (result.ok) return
    if (result.error) errors.push(result.error)
    await new Promise((r) => setTimeout(r, 250))
  }
  const last = errors.length ? ` (last error: ${errors[errors.length - 1]})` : ""
  throw new Error(`Timed out waiting for server health: ${url}${last}`)
}

const appDir = process.cwd()
const repoDir = path.resolve(appDir, "../..")
const agentCoreDir = path.join(repoDir, "packages", "agent-core")

const extraArgs = (() => {
  const args = process.argv.slice(2)
  if (args[0] === "--") return args.slice(1)
  return args
})()

const [serverPort, webPort] = await Promise.all([freePort(), freePort()])

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "agent-core-e2e-"))

const serverEnv = {
  ...process.env,
  // Keep e2e isolated, quiet, and fast.
  AGENT_CORE_DISABLE_FILEWATCHER: "true",
  AGENT_CORE_DISABLE_MODELS_FETCH: "true",
  AGENT_CORE_TEST_HOME: path.join(sandbox, "home"),
  HOME: path.join(sandbox, "home"),
  XDG_DATA_HOME: path.join(sandbox, "share"),
  XDG_CACHE_HOME: path.join(sandbox, "cache"),
  XDG_CONFIG_HOME: path.join(sandbox, "config"),
  XDG_STATE_HOME: path.join(sandbox, "state"),
  AGENT_CORE_E2E_PROJECT_DIR: repoDir,
  AGENT_CORE_E2E_SESSION_TITLE: "E2E Session",
  AGENT_CORE_E2E_MESSAGE: "Seeded for UI e2e",
  // Only used as metadata in the seed session; does not require a live provider.
  AGENT_CORE_E2E_MODEL: "openai/gpt-5-nano",
  AGENT_CORE_CLIENT: "app",
} satisfies Record<string, string>

const runnerEnv = {
  ...process.env,
  PLAYWRIGHT_SERVER_HOST: "127.0.0.1",
  PLAYWRIGHT_SERVER_PORT: String(serverPort),
  VITE_AGENT_CORE_SERVER_HOST: "127.0.0.1",
  VITE_AGENT_CORE_SERVER_PORT: String(serverPort),
  PLAYWRIGHT_PORT: String(webPort),
} satisfies Record<string, string>

const seed = Bun.spawn(["bun", "script/seed-e2e.ts"], {
  cwd: agentCoreDir,
  env: serverEnv,
  stdout: "inherit",
  stderr: "inherit",
})

const seedExit = await seed.exited
if (seedExit !== 0) {
  process.exit(seedExit)
}

Object.assign(process.env, serverEnv)

const server = Bun.spawn(
  [
    "bun",
    "run",
    "--conditions=browser",
    "./src/index.ts",
    "serve",
    "--hostname=127.0.0.1",
    `--port=${serverPort}`,
  ],
  {
    cwd: agentCoreDir,
    env: serverEnv,
    stdout: "inherit",
    stderr: "inherit",
  },
)

console.log(`agent-core server listening on http://127.0.0.1:${serverPort}`)

const result = await (async () => {
  try {
    await waitForHealth(`http://127.0.0.1:${serverPort}/global/health`)

    const runner = Bun.spawn(["bun", "test:e2e", ...extraArgs], {
      cwd: appDir,
      env: runnerEnv,
      stdout: "inherit",
      stderr: "inherit",
    })

    return { code: await runner.exited }
  } catch (error) {
    return { error }
  } finally {
    server.kill()
  }
})()

if ("error" in result) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.code)
