import { $ } from "bun"
import path from "node:path"
import z from "zod"
import { Worktree } from "./index"
import { Instance } from "../project/instance"
import { fn } from "../util/fn"

export namespace Dmux {
  const DEFAULT_SESSION_PREFIX = "zee-dmux"

  export const Agent = z.enum(["zee", "codex", "claude", "terminal"]).meta({
    ref: "DmuxAgent",
  })
  export type Agent = z.infer<typeof Agent>

  export const SpawnInput = z
    .object({
      name: z.string().optional(),
      prompt: z.string().optional(),
      agent: Agent.default("zee").optional(),
      session: z.string().optional(),
      socket: z.string().optional(),
      launch: z.boolean().default(true).optional(),
      command: z.string().optional(),
      hookCreate: z.string().optional(),
    })
    .meta({
      ref: "DmuxSpawnInput",
    })
  export type SpawnInput = z.infer<typeof SpawnInput>

  export const SpawnResult = z
    .object({
      name: z.string(),
      branch: z.string(),
      directory: z.string(),
      session: z.string(),
      window: z.string(),
      socket: z.string().optional(),
      command: z.string().optional(),
      launched: z.boolean(),
    })
    .meta({
      ref: "DmuxSpawnResult",
    })
  export type SpawnResult = z.infer<typeof SpawnResult>

  export const MergeInput = z
    .object({
      directory: z.string(),
      message: z.string().default("dmux: merge lane").optional(),
      squash: z.boolean().default(false).optional(),
      removeWorktree: z.boolean().default(true).optional(),
      hookPreMerge: z.string().optional(),
      hookPostMerge: z.string().optional(),
    })
    .meta({
      ref: "DmuxMergeInput",
    })
  export type MergeInput = z.infer<typeof MergeInput>

  export const MergeResult = z
    .object({
      directory: z.string(),
      laneBranch: z.string(),
      targetBranch: z.string(),
      head: z.string(),
      removed: z.boolean(),
      squash: z.boolean(),
    })
    .meta({
      ref: "DmuxMergeResult",
    })
  export type MergeResult = z.infer<typeof MergeResult>

  function safeSessionName(input?: string) {
    const raw = (input ?? `${DEFAULT_SESSION_PREFIX}-${Instance.project.id.slice(0, 8)}`).trim()
    const normalized = raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
    return normalized || `${DEFAULT_SESSION_PREFIX}-main`
  }

  function safeWindowName(input: string) {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
      .slice(0, 48)
  }

  function outputText(input: Uint8Array | undefined) {
    if (!input?.length) return ""
    return new TextDecoder().decode(input).trim()
  }

  function resultError(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
    return [outputText(result.stderr), outputText(result.stdout)].filter(Boolean).join("\n")
  }

  function buildAgentCommand(agent: Agent, prompt: string | undefined, directory: string): string {
    const escapedPrompt = JSON.stringify((prompt ?? "").trim())
    switch (agent) {
      case "terminal":
        return `cd ${JSON.stringify(directory)}`
      case "codex":
        return `cd ${JSON.stringify(directory)} && codex ${escapedPrompt}`
      case "claude":
        return `cd ${JSON.stringify(directory)} && claude ${escapedPrompt}`
      case "zee":
      default:
        return `cd ${JSON.stringify(directory)} && zee --full-auto ${escapedPrompt}`
    }
  }

  async function runHook(label: string, command: string | undefined, cwd: string) {
    const cmd = command?.trim()
    if (!cmd) return
    const result = await $`bash -lc ${cmd}`.quiet().nothrow().cwd(cwd)
    if (result.exitCode !== 0) {
      throw new Error(`${label} hook failed: ${resultError(result) || "unknown error"}`)
    }
  }

  async function tmux(args: string[], socket?: string) {
    if (socket) return $`tmux -S ${socket} ${args}`.quiet().nothrow()
    return $`tmux ${args}`.quiet().nothrow()
  }

  async function tmuxChecked(args: string[], socket: string | undefined, label: string) {
    const result = await tmux(args, socket)
    if (result.exitCode !== 0) {
      throw new Error(`${label} failed: ${resultError(result) || "unknown error"}`)
    }
    return result
  }

  async function getGitBranch(cwd: string): Promise<string> {
    const result = await $`git rev-parse --abbrev-ref HEAD`.quiet().nothrow().cwd(cwd)
    if (result.exitCode !== 0) {
      throw new Error(`Failed to get git branch: ${resultError(result) || "unknown error"}`)
    }
    return outputText(result.stdout)
  }

  async function getGitHead(cwd: string): Promise<string> {
    const result = await $`git rev-parse HEAD`.quiet().nothrow().cwd(cwd)
    if (result.exitCode !== 0) {
      throw new Error(`Failed to get git head: ${resultError(result) || "unknown error"}`)
    }
    return outputText(result.stdout)
  }

  async function commitIfDirty(cwd: string, message: string) {
    const status = await $`git status --porcelain=v1`.quiet().nothrow().cwd(cwd)
    if (status.exitCode !== 0) {
      throw new Error(`Failed to read git status: ${resultError(status) || "unknown error"}`)
    }
    if (!outputText(status.stdout)) return

    const add = await $`git add -A`.quiet().nothrow().cwd(cwd)
    if (add.exitCode !== 0) {
      throw new Error(`Failed to stage changes: ${resultError(add) || "unknown error"}`)
    }

    const commit = await $`git commit -m ${message}`.quiet().nothrow().cwd(cwd)
    if (commit.exitCode !== 0) {
      throw new Error(`Failed to commit changes: ${resultError(commit) || "unknown error"}`)
    }
  }

  export const spawn = fn(SpawnInput, async (input) => {
    const agent = input.agent ?? "zee"
    const lane = await Worktree.create({ name: input.name })

    await runHook("create", input.hookCreate, lane.directory)

    const session = safeSessionName(input.session)
    const window = safeWindowName(lane.name)
    const command = input.command?.trim() || buildAgentCommand(agent, input.prompt, lane.directory)
    const launch = input.launch ?? true

    if (launch) {
      const hasSession = await tmux(["has-session", "-t", session], input.socket)

      if (hasSession.exitCode !== 0) {
        await tmuxChecked(
          ["new-session", "-d", "-s", session, "-n", window],
          input.socket,
          `tmux new-session (${session})`,
        )
      } else {
        await tmuxChecked(
          ["new-window", "-t", session, "-n", window],
          input.socket,
          `tmux new-window (${session}:${window})`,
        )
      }

      const target = `${session}:${window}`
      await tmuxChecked(["send-keys", "-t", target, "-l", "--", command], input.socket, `tmux send-keys (${target})`)
      await tmuxChecked(["send-keys", "-t", target, "Enter"], input.socket, `tmux send Enter (${target})`)
    }

    return SpawnResult.parse({
      ...lane,
      session,
      window,
      socket: input.socket,
      command,
      launched: launch,
    })
  })

  export const merge = fn(MergeInput, async (input) => {
    const laneDir = path.resolve(input.directory)
    const message = input.message ?? "dmux: merge lane"
    const squash = input.squash ?? false
    const removeWorktree = input.removeWorktree ?? true

    await runHook("pre-merge", input.hookPreMerge, laneDir)
    await commitIfDirty(laneDir, message)

    const laneBranch = await getGitBranch(laneDir)
    const targetBranch = await getGitBranch(Instance.worktree)

    if (squash) {
      const squashResult = await $`git merge --squash ${laneBranch}`.quiet().nothrow().cwd(Instance.worktree)
      if (squashResult.exitCode !== 0) {
        throw new Error(`Squash merge failed: ${resultError(squashResult) || "unknown error"}`)
      }
      await commitIfDirty(Instance.worktree, message)
    } else {
      const mergeResult = await $`git merge --no-ff -m ${message} ${laneBranch}`.quiet().nothrow().cwd(Instance.worktree)
      if (mergeResult.exitCode !== 0) {
        throw new Error(`Merge failed: ${resultError(mergeResult) || "unknown error"}`)
      }
    }

    await runHook("post-merge", input.hookPostMerge, Instance.worktree)

    let removed = false
    if (removeWorktree) {
      await Worktree.remove({ directory: laneDir })
      removed = true
    }

    return MergeResult.parse({
      directory: laneDir,
      laneBranch,
      targetBranch,
      head: await getGitHead(Instance.worktree),
      removed,
      squash,
    })
  })
}
