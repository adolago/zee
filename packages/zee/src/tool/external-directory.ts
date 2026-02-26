import path from "path"
import fs from "fs/promises"
import type { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

async function resolvePromptParentDir(target: string, kind: Kind): Promise<string> {
  const parentDir = kind === "directory" ? target : path.dirname(target)

  // Best-effort resolve symlinks so permission requests reference the actual external directory.
  // This avoids prompting for the in-project symlink path when it resolves outside the instance.
  if (kind === "directory") {
    return await fs.realpath(parentDir).catch(() => parentDir)
  }

  const resolvedTarget = await fs.realpath(target).catch(() => undefined)
  if (resolvedTarget) return path.dirname(resolvedTarget)

  return await fs.realpath(parentDir).catch(() => parentDir)
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  if (options?.bypass) return

  const kind = options?.kind ?? "file"

  // Block hardlinked regular files to prevent workspace alias escapes.
  if (kind === "file" && (await Filesystem.isSuspiciousHardlink(target))) {
    throw new Error(`Refusing hardlinked file path outside workspace trust boundary: ${target}`)
  }

  if (Instance.containsPath(target)) return

  const parentDir = await resolvePromptParentDir(target, kind)
  const glob = path.join(parentDir, "*")

  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: target,
      parentDir,
    },
  })
}
