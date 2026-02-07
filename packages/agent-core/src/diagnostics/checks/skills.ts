/**
 * @file Skills Checks
 * @description Health checks for skill discovery, loading, and configuration
 */

import type { CheckResult, CheckOptions } from "../types"
import { Skill } from "../../skill"
import { Instance } from "../../project/instance"

/**
 * Get a cached audit report, bootstrapping Instance if needed.
 * The check command doesn't call bootstrap(), so Skill.audit() would
 * fail with "No context found for instance". We handle that here.
 */
let cachedReport: Skill.AuditReport | undefined
async function getAuditReport(): Promise<Skill.AuditReport> {
  if (cachedReport) return cachedReport

  try {
    cachedReport = await Skill.audit()
  } catch {
    // Instance not bootstrapped - provide one for the skill scan
    cachedReport = await Instance.provide({
      directory: process.cwd(),
      fn: () => Skill.audit(),
    })
  }
  return cachedReport
}

/**
 * Check total loaded skills and per-persona distribution
 */
async function checkLoadedSkills(): Promise<CheckResult> {
  const start = Date.now()

  try {
    const report = await getAuditReport()
    const loaded = report.loaded

    if (loaded.length === 0) {
      return {
        id: "skills.loaded",
        name: "Loaded Skills",
        category: "skills",
        status: "warn",
        message: "No skills loaded",
        details: "Check skill directories: .agents/skills/, .claude/skills/",
        severity: "warning",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    }

    const byPersona = {
      zee: loaded.filter((s) => s.context === "zee").length,
      stanley: loaded.filter((s) => s.context === "stanley").length,
      johny: loaded.filter((s) => s.context === "johny").length,
      shared: loaded.filter((s) => !s.context).length,
    }

    const distribution = `zee(${byPersona.zee}), stanley(${byPersona.stanley}), johny(${byPersona.johny}), shared(${byPersona.shared})`

    return {
      id: "skills.loaded",
      name: "Loaded Skills",
      category: "skills",
      status: "pass",
      message: `${loaded.length} skills loaded: ${distribution}`,
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { total: loaded.length, byPersona },
    }
  } catch (error) {
    return {
      id: "skills.loaded",
      name: "Loaded Skills",
      category: "skills",
      status: "fail",
      message: "Failed to check loaded skills",
      details: error instanceof Error ? error.message : String(error),
      severity: "error",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

/**
 * Check for skills excluded during loading
 */
async function checkExclusions(): Promise<CheckResult> {
  const start = Date.now()

  try {
    const report = await getAuditReport()
    const excluded = report.excluded

    if (excluded.length === 0) {
      return {
        id: "skills.exclusions",
        name: "Skill Exclusions",
        category: "skills",
        status: "pass",
        message: "No skills excluded",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    }

    const reasons = excluded.map((e) => `${e.name || e.path}: ${e.reason}`)

    return {
      id: "skills.exclusions",
      name: "Skill Exclusions",
      category: "skills",
      status: "warn",
      message: `${excluded.length} skills excluded`,
      details: reasons.join("\n"),
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { excluded },
    }
  } catch (error) {
    return {
      id: "skills.exclusions",
      name: "Skill Exclusions",
      category: "skills",
      status: "fail",
      message: "Failed to check exclusions",
      details: error instanceof Error ? error.message : String(error),
      severity: "error",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

/**
 * Check for name conflicts between skills
 */
async function checkConflicts(): Promise<CheckResult> {
  const start = Date.now()

  try {
    const report = await getAuditReport()
    const conflicts = report.conflicts

    if (conflicts.length === 0) {
      return {
        id: "skills.conflicts",
        name: "Skill Conflicts",
        category: "skills",
        status: "pass",
        message: "No name conflicts",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    }

    const details = conflicts.map((c) => `"${c.name}": kept ${c.kept}, shadowed ${c.shadowed.join(", ")}`).join("\n")

    return {
      id: "skills.conflicts",
      name: "Skill Conflicts",
      category: "skills",
      status: "warn",
      message: `${conflicts.length} name conflicts`,
      details,
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { conflicts },
    }
  } catch (error) {
    return {
      id: "skills.conflicts",
      name: "Skill Conflicts",
      category: "skills",
      status: "fail",
      message: "Failed to check conflicts",
      details: error instanceof Error ? error.message : String(error),
      severity: "error",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

/**
 * Check for missing environment variables in loaded skills
 */
async function checkMissingEnv(): Promise<CheckResult> {
  const start = Date.now()

  try {
    const report = await getAuditReport()
    const missing = report.missingEnv

    if (missing.length === 0) {
      return {
        id: "skills.missing-env",
        name: "Missing Environment Variables",
        category: "skills",
        status: "pass",
        message: "All required env vars present",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    }

    const total = missing.reduce((sum, m) => sum + m.vars.length, 0)
    const details = missing.map((m) => `${m.skill}: ${m.vars.join(", ")}`).join("\n")

    return {
      id: "skills.missing-env",
      name: "Missing Environment Variables",
      category: "skills",
      status: "warn",
      message: `${total} missing env vars across ${missing.length} skills`,
      details,
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { missing },
    }
  } catch (error) {
    return {
      id: "skills.missing-env",
      name: "Missing Environment Variables",
      category: "skills",
      status: "fail",
      message: "Failed to check env vars",
      details: error instanceof Error ? error.message : String(error),
      severity: "error",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

/**
 * Check skill frontmatter completeness (extended check)
 */
async function checkFrontmatterCompleteness(): Promise<CheckResult> {
  const start = Date.now()

  try {
    const report = await getAuditReport()
    const incomplete: string[] = []

    for (const skill of report.loaded) {
      if (!skill.name || !skill.description) {
        incomplete.push(skill.name || skill.location)
      }
    }

    if (incomplete.length === 0) {
      return {
        id: "skills.frontmatter",
        name: "Frontmatter Completeness",
        category: "skills",
        status: "pass",
        message: "All skills have complete frontmatter",
        severity: "info",
        durationMs: Date.now() - start,
        autoFixable: false,
      }
    }

    return {
      id: "skills.frontmatter",
      name: "Frontmatter Completeness",
      category: "skills",
      status: "warn",
      message: `${incomplete.length} skills missing required fields`,
      details: `Incomplete: ${incomplete.join(", ")}`,
      severity: "warning",
      durationMs: Date.now() - start,
      autoFixable: false,
      metadata: { incomplete },
    }
  } catch (error) {
    return {
      id: "skills.frontmatter",
      name: "Frontmatter Completeness",
      category: "skills",
      status: "fail",
      message: "Failed to check frontmatter",
      details: error instanceof Error ? error.message : String(error),
      severity: "error",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }
}

/**
 * Run all skill health checks
 */
export async function runSkillChecks(options: CheckOptions): Promise<CheckResult[]> {
  cachedReport = undefined
  const results: CheckResult[] = []

  results.push(await checkLoadedSkills())
  results.push(await checkExclusions())
  results.push(await checkConflicts())
  results.push(await checkMissingEnv())

  if (options.full) {
    results.push(await checkFrontmatterCompleteness())
  }

  return results
}
