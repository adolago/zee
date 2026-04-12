import z from "zod"
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
import { createSafeEnv } from "@/security/env-sanitize"
import { AppDeps } from "@/app/deps"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.ZEE_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000
// SAFETY: Hard limit on total output to prevent memory exhaustion from runaway commands
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024 // 10MB - kills command if exceeded

export const log = Log.create({ service: "bash-tool" })

const WRAPPER_COMMANDS = new Set(["sudo", "doas", "env"])
const FILE_STATE_COMMANDS = new Set([
  "rm",
  "mv",
  "cp",
  "mkdir",
  "rmdir",
  "touch",
  "chmod",
  "chown",
  "ln",
  "unlink",
  "truncate",
  "install",
  "dd",
  "tee",
])
const PROCESS_STATE_COMMANDS = new Set(["kill", "pkill", "killall", "renice"])
const SYSTEM_STATE_COMMANDS = new Set([
  "systemctl",
  "service",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "mount",
  "umount",
  "iptables",
  "ip6tables",
  "ufw",
  "crontab",
  "at",
  "launchctl",
])
const GIT_MUTATING_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
  "tag",
])
const REDIRECTION_PATTERN = /(^|[\s;|&])(?:\d*>>?|\&>>?)(?=\s|$)/

function tokenize(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

function unwrapLeadingWrappers(tokens: string[]): string[] {
  let idx = 0
  while (idx < tokens.length) {
    const token = tokens[idx]?.toLowerCase()
    if (!token || !WRAPPER_COMMANDS.has(token)) break

    if (token === "env") {
      idx++
      while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[idx]!)) idx++
      continue
    }

    idx++
    while (idx < tokens.length && tokens[idx]!.startsWith("-")) {
      const flag = tokens[idx]!
      idx++
      if (["-u", "-g", "-h", "-p", "-C", "-D", "-T", "-R", "-U", "-r"].includes(flag) && idx < tokens.length) {
        idx++
      }
    }
  }
  return tokens.slice(idx)
}

export async function isFileModifyingCommand(
  command: string,
  options?: { blocklist?: Set<string> },
): Promise<{ modifying: boolean; reason?: string }> {
  const text = command.trim()
  if (!text) return { modifying: false }

  if (REDIRECTION_PATTERN.test(text)) {
    return { modifying: true, reason: "contains output redirection" }
  }

  const tokens = unwrapLeadingWrappers(tokenize(text))
  if (tokens.length === 0) return { modifying: false }

  const cmd = tokens[0]!.toLowerCase()
  const args = tokens.slice(1).map((t) => t.toLowerCase())

  if (options?.blocklist?.has(cmd)) {
    return { modifying: true, reason: `${cmd} is blocked by policy` }
  }

  if (cmd === "git") {
    const sub = args[0]
    if (sub && GIT_MUTATING_SUBCOMMANDS.has(sub)) {
      return { modifying: true, reason: `git ${sub} mutates repository state` }
    }
    return { modifying: false }
  }

  if (cmd === "sed" && args.some((arg) => arg === "-i" || arg.startsWith("-i"))) {
    return { modifying: true, reason: "sed -i edits files in place" }
  }

  if (FILE_STATE_COMMANDS.has(cmd)) {
    return { modifying: true, reason: `${cmd} mutates file state` }
  }
  if (PROCESS_STATE_COMMANDS.has(cmd)) {
    return { modifying: true, reason: `${cmd} mutates process state` }
  }
  if (SYSTEM_STATE_COMMANDS.has(cmd)) {
    return { modifying: true, reason: `${cmd} mutates system state` }
  }

  return { modifying: false }
}

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

function shellName(shell: string) {
  let name = path.basename(shell)
  if (shell.includes("\\") || shell.includes("/")) {
    const parts = shell.split(/[\\/]/)
    name = parts[parts.length - 1] || name
  }
  return name.toLowerCase().endsWith(".exe") ? name.slice(0, -4) : name
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
  const actualShell = shellName(shell)
  log.info("bash tool using shell", { shell, actualShell })

  let description = DESCRIPTION.replaceAll("${shellName}", actualShell)
    .replaceAll("${directory}", Instance.directory)
    .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
    .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES))

  description = `**Shell**: You are executing commands in \`${actualShell}\`. Ensure your command syntax is compatible with this shell.

${description}`

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

      if (ctx.extra?.mode === "plan") {
        const check = await isFileModifyingCommand(params.command)
        if (check.modifying) {
          const blockedOutput = `PLAN mode: Command blocked because it may modify state (${check.reason ?? "state-changing command"}). Switch to ACCEPT or BYPASS mode to run mutating commands.`
          return {
            title: "Blocked in PLAN mode",
            metadata: {
              output: blockedOutput,
              exit: 1 as number | null,
              description: params.description,
            },
            output: blockedOutput,
          }
        }
      }

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

        // Get full command text including redirects if present
        let commandText = node.parent?.type === "redirected_statement" ? node.parent.text : node.text

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
          patterns.add(commandText)
          always.add(BashArity.prefix(command).join(" ") + " *")
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

      const deps = AppDeps.use()
      const shellEnv = await deps.pluginTrigger("shell.env", { cwd }, { env: {} })
      const safeEnv = createSafeEnv(process.env, { validatePath: process.platform !== "win32" })
      const proc = await Shell.spawnWithRetry(params.command, {
        shell,
        cwd,
        env: {
          ...safeEnv,
          ...shellEnv.env,
        },
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
            "This prevents memory exhaustion from runaway commands. Use more specific commands or output redirection to files.",
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
