// Skill hot-reload via filesystem watcher.

import chokidar from "chokidar"
import path from "path"
import { Log } from "../util/log"
import { GlobalBus } from "../bus/global"
import { Global } from "../global"
import { Skill } from "./skill"

const log = Log.create({ service: "skill:watcher" })

/** Event type emitted on GlobalBus when skills change. */
export const SKILL_CHANGE_EVENT = "skill.change" as const

let globalVersion = 0
let watcher: ReturnType<typeof chokidar.watch> | null = null

/**
 * Get the current global skill snapshot version.
 * Sessions compare this against their cached version to know if skills need reload.
 */
export function getSkillsVersion(): number {
  return globalVersion
}

/**
 * Manually bump the skill version (e.g., after installing a new skill).
 */
export function bumpSkillsVersion(reason: "watch" | "manual" = "manual") {
  globalVersion = Date.now()
  log.info("skills version bumped", { version: globalVersion, reason })
  GlobalBus.emit("event", {
    payload: { type: SKILL_CHANGE_EVENT, properties: { reason } },
  })
}

export type SkillWatcherOptions = {
  /** Project directory containing .agents/skills/ */
  directory: string
  /** Debounce interval in ms. Default: 250. */
  debounceMs?: number
}

/**
 * Start watching skill directories for changes.
 * When a SKILL.md file changes, bumps the global version counter
 * so active sessions know to reload their skill snapshots.
 */
export function startSkillWatcher(opts: SkillWatcherOptions): void {
  if (watcher) {
    return // already watching
  }

  const debounceMs = opts.debounceMs ?? 250
  const watchPaths: string[] = []

  // Project-level .agents/skills/
  const projectSkills = path.join(opts.directory, ".agents", "skills")
  watchPaths.push(projectSkills)

  // Global ~/.agents/skills/
  const globalAgentsSkills = path.join(Global.Path.home, ".agents", "skills")
  watchPaths.push(globalAgentsSkills)

  // Global config skills
  const configSkills = path.join(Global.Path.config, "skills")
  watchPaths.push(configSkills)

  // Project-level .claude/skills/
  const projectClaudeSkills = path.join(opts.directory, ".claude", "skills")
  watchPaths.push(projectClaudeSkills)

  // Global ~/.claude/skills/
  const globalClaudeSkills = path.join(Global.Path.home, ".claude", "skills")
  watchPaths.push(globalClaudeSkills)

  // Supplement with Skill.directories() when available (async, best-effort)
  Skill.directories().then((dirs) => {
    const newPaths = dirs.filter((d) => !watchPaths.includes(d))
    if (newPaths.length > 0 && watcher) {
      watcher.add(newPaths)
      log.info("skill watcher: added directories from Skill.directories()", {
        count: newPaths.length,
      })
    }
  }).catch((err) => {
    log.debug("skill watcher: could not load Skill.directories()", {
      error: err instanceof Error ? err.message : String(err),
    })
  })

  log.info("starting skill watcher", { paths: watchPaths })

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: debounceMs },
    ignored: [/\.git/, /node_modules/, /dist/],
    depth: 10,
  })

  const onChange = (filePath: string) => {
    // Only care about SKILL.md files
    if (!filePath.endsWith("SKILL.md")) {
      return
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null
      bumpSkillsVersion("watch")
    }, debounceMs)
  }

  watcher.on("add", onChange)
  watcher.on("change", onChange)
  watcher.on("unlink", onChange)

  watcher.on("error", (error) => {
    log.error("skill watcher error", {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

/**
 * Stop the skill watcher.
 */
export async function stopSkillWatcher(): Promise<void> {
  if (watcher) {
    await watcher.close()
    watcher = null
    log.info("skill watcher stopped")
  }
}
