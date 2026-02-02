import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"

import { $ } from "bun"
import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncation"
import { HoldMode } from "@/config/hold-mode"
import { createSafeEnv } from "@/security/env-sanitize"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.AGENT_CORE_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000
// SAFETY: Hard limit on total output to prevent memory exhaustion from runaway commands
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024 // 10MB - kills command if exceeded

export const log = Log.create({ service: "bash-tool" })

/**
 * Check if a command would modify state (files, processes, system).
 * This is a compatibility wrapper that uses the unified hold-mode command checking.
 * @deprecated Use HoldMode.checkCommand() instead for full hold-mode integration.
 */
export async function isFileModifyingCommand(
  command: string,
  options?: { blocklist?: Set<string> }
): Promise<{ modifying: boolean; reason?: string }> {
  // If a custom blocklist is provided, use the internal check
  if (options?.blocklist) {
    const result = await HoldMode.checkCommand(command, { holdMode: true })
    // The result.blocked indicates if the command is blocked in hold mode
    // which means it would modify state
    return { modifying: result.blocked, reason: result.reason }
  }

  // Default: use hold mode check which includes all profile-based blocking
  const result = await HoldMode.checkCommand(command, { holdMode: true })
  return { modifying: result.blocked, reason: result.reason }
}

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

export const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// NOTE: Tool is named 'bash' for backwards compatibility, but it uses the system's
// preferred shell (detected by Shell.acceptable()). Renaming would break existing prompts.
export const BashTool = Tool.define("bash", async (initCtx) => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  let description = DESCRIPTION.replaceAll("${directory}", Instance.directory)
    .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
    .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES))

  // Persona agents don't need git commit/PR workflow instructions
  if (initCtx?.agent?.native === true) {
    const gitSection = description.indexOf("\n# Committing changes with git")
    if (gitSection !== -1) {
      description = description.slice(0, gitSection).trimEnd()
    }
  }

  return {
    description,
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params: { command: string; timeout?: number; workdir?: string; description: string }, ctx) {
      const cwd = params.workdir || Instance.directory

      // Use unified checkCommand for all hold-mode checks
      const holdMode = ctx.extra?.holdMode === true
      const skipPermissions = ctx.extra?.skipPermissions === true
      const checkResult = await HoldMode.checkCommand(params.command, { holdMode, skipPermissions })

      if (checkResult.blocked) {
        // Command is blocked (either always_block or profile-based blocklist in HOLD mode)
        if (checkResult.matchedPattern) {
          // Blocked by always_block pattern
          const blockedOutput = `BLOCKED: Command "${params.command}" is in always_block list and cannot be executed.`
          log.info("blocked command from always_block list", { command: params.command, pattern: checkResult.matchedPattern })
          return {
            title: "Blocked by config",
            metadata: {
              output: blockedOutput,
              exit: 1 as number | null,
              description: params.description,
            },
            output: blockedOutput,
          }
        } else {
          // Blocked by profile-based blocklist in HOLD mode
          const holdConfig = await HoldMode.load()
          log.info("blocked state-modifying command in HOLD mode", {
            command: params.command,
            reason: checkResult.reason,
            profile: checkResult.profile,
          })
          const blockedOutput = `HOLD MODE: Command blocked because it would modify state (${checkResult.reason}).

In HOLD mode (profile: ${checkResult.profile}), you cannot:
- Edit files (sed -i, etc.)
- Create/delete files (touch, rm, mkdir, etc.)
- Use output redirection (>, >>, 2>, &>)
- Modify git state (git add, commit, push, etc.)
- Control processes (kill, pkill, renice)
- Modify system state (systemctl, shutdown, mount, iptables, etc.)
${checkResult.profile === 'strict' ? '- Run interpreters (python, node, etc.)\n- Use network tools (curl, wget, ssh)\n- Schedule tasks (crontab, at)' : ''}

You can:
- Read files (cat, head, tail)
- Search (grep, find, rg)
- View git state (git status, log, diff)
- Run tests and builds
${holdConfig.hold_allow.length > 0 ? `- Allowed exceptions: ${holdConfig.hold_allow.join(', ')}` : ''}

To modify state, the user must switch to RELEASE mode.`
          return {
            title: "Blocked in HOLD mode",
            metadata: {
              output: blockedOutput,
              exit: 1 as number | null,
              description: params.description,
            },
            output: blockedOutput,
          }
        }
      }

      // RELEASE mode: release_confirm checks are handled by HoldMode.checkCommand
      // In RELEASE mode (holdMode: false), all commands are auto-approved except:
      // - Commands in always_block (blocked entirely)
      // - Commands blocked by profile-based blocklist in HOLD mode
      // The requiresConfirmation flag is no longer used in RELEASE mode

      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()

      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue
        const command = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue
          if (
            child.type !== "command_name" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
          ) {
            continue
          }
          command.push(child.text)
        }

        // not an exhaustive list, but covers most common cases
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
            const resolved = await $`realpath ${arg}`
              .cwd(cwd)
              .quiet()
              .nothrow()
              .text()
              .then((x) => x.trim())
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              // Git Bash on Windows returns Unix-style paths like /c/Users/...
              const normalized =
                process.platform === "win32" && resolved.match(/^\/[a-z]\//)
                  ? resolved.replace(/^\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\")
                  : resolved
              if (!Instance.containsPath(normalized)) directories.add(normalized)
            }
          }
        }

        // cd covered by above check
        if (command.length && command[0] !== "cd") {
          patterns.add(command.join(" "))
          always.add(BashArity.prefix(command).join(" ") + "*")
        }
      }

      if (directories.size > 0) {
        await ctx.ask({
          permission: "external_directory",
          patterns: Array.from(directories),
          always: Array.from(directories).map((x) => path.dirname(x) + "*"),
          metadata: {},
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      const safeEnv = createSafeEnv(process.env, { validatePath: process.platform !== "win32" })
      const proc = spawn(params.command, {
        shell,
        cwd,
        env: safeEnv,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      let output = ""
      let outputBytes = 0
      let killedForSize = false

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        // SAFETY: Hard limit enforcement - kill process if output exceeds max
        outputBytes += chunk.length
        if (outputBytes > MAX_OUTPUT_BYTES && !killedForSize) {
          killedForSize = true
          log.warn("command exceeded max output size, killing", {
            command: params.command,
            bytes: outputBytes,
            limit: MAX_OUTPUT_BYTES,
          })
          void kill()
          return
        }
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            // truncate the metadata to avoid GIANT blobs of data (has nothing to do w/ what agent can access)
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
        }

        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      const resultMetadata: string[] = []

      if (killedForSize) {
        resultMetadata.push(
          `SECURITY: Command killed after exceeding ${MAX_OUTPUT_BYTES} bytes output limit. ` +
            "This prevents memory exhaustion from runaway commands. Use more specific commands or output redirection to files."
        )
      }

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          description: params.description,
        },
        output,
      }
    },
  }
})
