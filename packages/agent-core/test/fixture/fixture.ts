import { $ } from "bun"
import * as fs from "fs/promises"
import { randomUUID } from "node:crypto"
import os from "os"
import path from "path"
import type { Config } from "../../src/config/config"

// Strip null bytes from paths (defensive fix for CI environment issues)
function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}

type TmpDirOptions<T> = {
  git?: boolean
  config?: Partial<Config.Info>
  init?: (dir: string) => Promise<T>
  dispose?: (dir: string) => Promise<T>
}
const hasNullByte = (value: unknown) => typeof value === "string" && value.includes("\0")
const skipNullPathBug = Bun.version === "1.3.5"
const shouldIgnoreNullBytePathError = (error: unknown) => {
  if (!error || typeof error !== "object") return false
  const code = (error as any).code
  const pathValue = (error as any).path
  const message = (error as any).message
  return code === "ENOENT" && (hasNullByte(pathValue) || hasNullByte(message))
}

async function run(cmd: string[], cwd: string) {
  const proc = Bun.spawn(cmd, { cwd, stderr: "inherit", stdout: "inherit" })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`Command failed with exit code ${code}: ${cmd.join(" ")}`)
  }
}

async function createTmpdir<T>(options: TmpDirOptions<T> | undefined) {
  const baseDir = process.env["AGENT_CORE_TEST_HOME"] ?? os.tmpdir()
  const rootDir = path.join(baseDir, "tmp")
  await fs.mkdir(rootDir, { recursive: true })
  const dirpath = sanitizePath(path.join(rootDir, "opencode-test-" + randomUUID()))
  await fs.mkdir(dirpath, { recursive: true })
  if (options?.git) {
    // Configure git user to prevent CI failures
    const env = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" }

    // Using Bun.spawn instead of Bun Shell to avoid ShellPromise errors in CI
    const spawnGit = async (args: string[]) => {
       const proc = Bun.spawn(["git", ...args], { cwd: dirpath, env, stdout: "ignore", stderr: "ignore" })
       const code = await proc.exited
       if (code !== 0) throw new Error(`git ${args.join(" ")} failed in ${dirpath}`)
    }

    await spawnGit(["init"])
    await spawnGit(["config", "user.email", "test@example.com"])
    await spawnGit(["config", "user.name", "Test User"])
    await spawnGit(["commit", "--allow-empty", "-m", `root commit ${dirpath}`])
  }
  if (options?.config) {
    await Bun.write(
      path.join(dirpath, "agent-core.json"),
      JSON.stringify({
        $schema: "agent-core",
        ...options.config,
      }),
    )
  }
  const extra = await options?.init?.(dirpath)
  let realpath = dirpath
  try {
    realpath = sanitizePath(await fs.realpath(dirpath))
  } catch {
    realpath = dirpath
  }
  const result = {
    [Symbol.asyncDispose]: async () => {
      try {
        await options?.dispose?.(dirpath)
      } catch (error) {
        if (!shouldIgnoreNullBytePathError(error)) throw error
      }
      if (skipNullPathBug) return
      try {
        await fs.rm(dirpath, { recursive: true, force: true })
      } catch (error) {
        if (!shouldIgnoreNullBytePathError(error)) throw error
      }
    },
    path: realpath,
    extra: extra as T,
  }
  return result
}

export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  try {
    return await createTmpdir(options)
  } catch (error) {
    if (!shouldIgnoreNullBytePathError(error)) throw error
    return await createTmpdir(options)
  }
}
