/**
 * Skill Environment Variable Overrides
 *
 * Applies per-skill environment variable overrides from zee config.
 * Ported from Zee's env-overrides.ts to unify skill configuration.
 *
 * Skills can declare a `primaryEnv` requirement (e.g., OPENAI_API_KEY).
 * The config can map skill names to env vars and API keys:
 *
 *   skills:
 *     entries:
 *       my-skill:
 *         apiKey: "sk-..."
 *         env:
 *           CUSTOM_VAR: "value"
 *
 * @module skill/env-overrides
 */

import { Config } from "../config/config"
import { Skill } from "./skill"
import { Log } from "../util/log"

const log = Log.create({ service: "skill:env" })

export interface EnvOverrideEntry {
  /** Skill name (key in config.skills.entries) */
  name: string
  /** Optional primary env var name from skill frontmatter */
  primaryEnv?: string
}

/**
 * Apply environment variable overrides from config for the given skills.
 * Only sets variables that are not already defined in process.env.
 * Returns a cleanup function that restores the previous values.
 */
export async function applySkillEnvOverrides(
  skills?: EnvOverrideEntry[],
): Promise<() => void> {
  const config = await Config.get()
  const entries = config.skills?.entries
  if (!entries || !skills?.length) return () => {}

  const updates: Array<{ key: string; prev: string | undefined }> = []

  for (const skill of skills) {
    const skillConfig = entries[skill.name]
    if (!skillConfig) continue

    // Apply env overrides (only if not already set)
    if (skillConfig.env) {
      for (const [envKey, envValue] of Object.entries(skillConfig.env)) {
        if (!envValue || process.env[envKey]) continue
        updates.push({ key: envKey, prev: process.env[envKey] })
        process.env[envKey] = envValue
      }
    }

    // Apply apiKey to primaryEnv (only if not already set)
    if (skill.primaryEnv && skillConfig.apiKey && !process.env[skill.primaryEnv]) {
      updates.push({ key: skill.primaryEnv, prev: process.env[skill.primaryEnv] })
      process.env[skill.primaryEnv] = skillConfig.apiKey
    }
  }

  if (updates.length > 0) {
    log.info("applied env overrides", {
      count: updates.length,
      keys: updates.map((u) => u.key),
    })
  }

  return () => {
    for (const update of updates) {
      if (update.prev === undefined) delete process.env[update.key]
      else process.env[update.key] = update.prev
    }
  }
}

/**
 * Apply overrides using the currently loaded skill state.
 * Convenience wrapper that fetches all skills and applies overrides.
 */
export async function applyAllSkillEnvOverrides(): Promise<() => void> {
  const skills = await Skill.all()
  const entries: EnvOverrideEntry[] = skills.map((s) => ({
    name: s.name,
    primaryEnv: s.primaryEnv,
  }))
  return applySkillEnvOverrides(entries)
}
