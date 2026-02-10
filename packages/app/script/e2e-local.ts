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
const zeeCoreDir = path.join(repoDir, "packages", "zee-core")

const extraArgs = (() => {
  const args = process.argv.slice(2)
  if (args[0] === "--") return args.slice(1)
  return args
})()

const [serverPort, webPort, mockPort] = await Promise.all([freePort(), freePort(), freePort()])

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "zee-e2e-"))

// ---------------------------------------------------------------------------
// Mock LLM server -- lightweight OpenAI-compatible endpoint for e2e tests.
// Returns the token from "Reply with exactly: <token>" prompts so the
// prompt e2e test can verify round-trip message delivery.
// ---------------------------------------------------------------------------
const mockLLM = Bun.serve({
  port: mockPort,
  hostname: "127.0.0.1",
  async fetch(req) {
    if (req.method === "POST" && new URL(req.url).pathname === "/v1/chat/completions") {
      const body = (await req.json()) as {
        messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
      }
      const last = body.messages?.findLast((m) => m.role === "user")
      const text =
        typeof last?.content === "string"
          ? last.content
          : Array.isArray(last?.content)
            ? last.content
                .filter((p) => p.type === "text")
                .map((p) => p.text ?? "")
                .join("")
            : ""
      const match = text.match(/Reply with exactly:\s*(.+)/)
      const reply = match ? match[1].trim() : "mock response"

      return Response.json({
        id: `mock-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "big-pickle",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      })
    }

    return new Response("Not Found", { status: 404 })
  },
})

console.log(`mock LLM server listening on http://127.0.0.1:${mockPort}`)

// ---------------------------------------------------------------------------
// Write e2e config override so the opencode provider routes to the mock LLM.
// Using AGENT_CORE_TEST_MANAGED_CONFIG_DIR (managed config loads LAST, highest
// precedence in config.ts:180-192) to override the project config's
// "model": "cerebras/zai-glm-4.7" with "opencode/big-pickle".
// The e2e-models.json fixture (loaded via AGENT_CORE_MODELS_PATH) supplies
// the model catalog; this config provides the connection details.
// ---------------------------------------------------------------------------
const overrideDir = path.join(sandbox, "e2e-override")
await fs.mkdir(overrideDir, { recursive: true })
await fs.writeFile(
  path.join(overrideDir, "zee.jsonc"),
  JSON.stringify({
    model: "opencode/big-pickle",
    agent: {
      zee: { model: "opencode/big-pickle" },
    },
    provider: {
      opencode: {
        options: {
          baseURL: `http://127.0.0.1:${mockPort}/v1`,
          apiKey: "e2e",
        },
      },
    },
  }),
)

const serverEnv = {
  ...process.env,
  // Keep e2e isolated, quiet, and fast.
  ZEE_DISABLE_FILEWATCHER: "true",
  ZEE_DISABLE_MODELS_FETCH: "true",
  ZEE_MODELS_PATH: path.join(repoDir, "packages/zee-core/test/fixture/e2e-models.json"),
  ZEE_TEST_HOME: path.join(sandbox, "home"),
  HOME: path.join(sandbox, "home"),
  XDG_DATA_HOME: path.join(sandbox, "share"),
  XDG_CACHE_HOME: path.join(sandbox, "cache"),
  XDG_CONFIG_HOME: path.join(sandbox, "config"),
  XDG_STATE_HOME: path.join(sandbox, "state"),
  ZEE_TEST_MANAGED_CONFIG_DIR: overrideDir,
  ZEE_E2E_PROJECT_DIR: repoDir,
  ZEE_E2E_SESSION_TITLE: "E2E Session",
  ZEE_E2E_MESSAGE: "Seeded for UI e2e",
  // Only used as metadata in the seed session; does not require a live provider.
  ZEE_E2E_MODEL: "openai/gpt-5-nano",
  ZEE_CLIENT: "app",

  // Legacy env vars (compat)
  AGENT_CORE_DISABLE_FILEWATCHER: "true",
  AGENT_CORE_DISABLE_MODELS_FETCH: "true",
  AGENT_CORE_MODELS_PATH: path.join(repoDir, "packages/zee-core/test/fixture/e2e-models.json"),
  AGENT_CORE_TEST_HOME: path.join(sandbox, "home"),
  AGENT_CORE_TEST_MANAGED_CONFIG_DIR: overrideDir,
  AGENT_CORE_E2E_PROJECT_DIR: repoDir,
  AGENT_CORE_E2E_SESSION_TITLE: "E2E Session",
  AGENT_CORE_E2E_MESSAGE: "Seeded for UI e2e",
  AGENT_CORE_E2E_MODEL: "openai/gpt-5-nano",
  AGENT_CORE_CLIENT: "app",
} satisfies Record<string, string>

const runnerEnv = {
  ...process.env,
  PLAYWRIGHT_SERVER_HOST: "127.0.0.1",
  PLAYWRIGHT_SERVER_PORT: String(serverPort),
  VITE_ZEE_SERVER_HOST: "127.0.0.1",
  VITE_ZEE_SERVER_PORT: String(serverPort),
  // Legacy Vite env vars (compat)
  VITE_AGENT_CORE_SERVER_HOST: "127.0.0.1",
  VITE_AGENT_CORE_SERVER_PORT: String(serverPort),
  PLAYWRIGHT_PORT: String(webPort),
} satisfies Record<string, string>

const bunExe = process.execPath

const seed = Bun.spawn([bunExe, "script/seed-e2e.ts"], {
  cwd: zeeCoreDir,
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
    bunExe,
    "run",
    "--conditions=browser",
    "./src/index.ts",
    "serve",
    "--hostname=127.0.0.1",
    `--port=${serverPort}`,
  ],
  {
    cwd: zeeCoreDir,
    env: serverEnv,
    stdout: "inherit",
    stderr: "inherit",
  },
)

console.log(`zee server listening on http://127.0.0.1:${serverPort}`)

const result = await (async () => {
  try {
    await waitForHealth(`http://127.0.0.1:${serverPort}/global/health`)

    const runner = Bun.spawn([bunExe, "test:e2e", ...extraArgs], {
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
    mockLLM.stop()
  }
})()

if ("error" in result) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.code)
