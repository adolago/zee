import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"

const cliEntry = path.resolve(import.meta.dir, "../../src/index.ts")
const packageRoot = path.resolve(import.meta.dir, "../..")

async function runCli(
  cwd: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, cliEntry, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  return { exitCode, stdout, stderr }
}

test("doctor security boots an instance before loading config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "zee.json"),
        JSON.stringify({
          $schema: "zee",
          server: {
            hostname: "127.0.0.1",
          },
        }),
      )
      await fs.mkdir(path.join(dir, ".config"), { recursive: true })
      await fs.mkdir(path.join(dir, ".state"), { recursive: true })
      await fs.mkdir(path.join(dir, ".managed"), { recursive: true })
    },
  })

  const env = {
    ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL: "true",
    ZEE_CONFIG_DIR: path.join(tmp.path, ".config"),
    ZEE_STATE_DIR: path.join(tmp.path, ".state"),
    ZEE_TEST_MANAGED_CONFIG_DIR: path.join(tmp.path, ".managed"),
    ZEE_TEST_POLICY_PATH: path.join(tmp.path, ".managed", "policy.jsonc"),
    ZEE_ROOT: packageRoot,
  }

  const result = await runCli(tmp.path, ["doctor", "security", "--json", "--deep"], env)

  expect(result.exitCode).toBe(0)
  expect(result.stderr).not.toContain("No context found for instance")

  const parsed = JSON.parse(result.stdout) as {
    mode: string
    ok: boolean
    findings: unknown[]
  }

  expect(parsed.mode).toBe("doctor-security")
  expect(typeof parsed.ok).toBe("boolean")
  expect(Array.isArray(parsed.findings)).toBe(true)
})

test("security audit boots an instance before loading config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "zee.json"),
        JSON.stringify({
          $schema: "zee",
          server: {
            hostname: "127.0.0.1",
          },
        }),
      )
      await fs.mkdir(path.join(dir, ".config"), { recursive: true })
      await fs.mkdir(path.join(dir, ".state"), { recursive: true })
      await fs.mkdir(path.join(dir, ".managed"), { recursive: true })
    },
  })

  const env = {
    ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL: "true",
    ZEE_CONFIG_DIR: path.join(tmp.path, ".config"),
    ZEE_STATE_DIR: path.join(tmp.path, ".state"),
    ZEE_TEST_MANAGED_CONFIG_DIR: path.join(tmp.path, ".managed"),
    ZEE_TEST_POLICY_PATH: path.join(tmp.path, ".managed", "policy.jsonc"),
    ZEE_ROOT: packageRoot,
  }

  const result = await runCli(tmp.path, ["security", "audit", "--json"], env)

  expect(result.exitCode).toBe(0)
  expect(result.stderr).not.toContain("No context found for instance")

  const parsed = JSON.parse(result.stdout) as {
    ok: boolean
    findings: unknown[]
  }

  expect(typeof parsed.ok).toBe("boolean")
  expect(Array.isArray(parsed.findings)).toBe(true)
})
