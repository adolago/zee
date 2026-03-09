/**
 * Skill Discovery Module - Filesystem-based skill discovery
 *
 * This module discovers skills from markdown files in a directory structure.
 * Skills are defined as .md files with optional YAML frontmatter.
 *
 * @example
 * ```typescript
 * // Discover skills from a directory
 * const skills = await discoverSkills('/path/to/skills', 'zee');
 *
 * // Parse a single skill file
 * const skill = await parseSkillFile('/path/to/skill.md', 'zee');
 *
 * // Register discovered skills with capability registry
 * for (const skill of skills) {
 *   registry.register(skill.agentName, [{
 *     name: skill.name,
 *     description: skill.description,
 *     requires: skill.requires,
 *     always: skill.always,
 *   }]);
 * }
 * ```
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename, dirname } from "node:path";

// ============================================================================
// Types
// ============================================================================

/**
 * Skill entry discovered from filesystem
 */
export interface SkillEntry {
  /** Skill name (derived from filename or frontmatter) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Unique key combining agent and skill name */
  skillKey: string;
  /** Agent that owns this skill */
  agentName: string;
  /** Filesystem path to skill file */
  filePath: string;
  /** Whether this skill is always available */
  always?: boolean;
  /** Required capabilities/prerequisites */
  requires?: string[];
  /** Trigger patterns for auto-invocation */
  triggers?: string[];
}

/**
 * Frontmatter parsed from skill markdown files
 */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  always?: boolean;
  requires?: string[];
  triggers?: string[];
}

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse simple YAML frontmatter from a string
 *
 * Handles basic key-value pairs and arrays.
 * Not a full YAML parser - only handles common skill frontmatter patterns.
 */
export function parseSimpleFrontmatter(yaml: string): SkillFrontmatter {
  const result: SkillFrontmatter = {};

  for (const line of yaml.split("\n")) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (!match) continue;

    const [, key, value] = match;
    const v = value.trim();

    switch (key) {
      case "name":
        result.name = v;
        break;
      case "description":
        result.description = v;
        break;
      case "always":
        result.always = v === "true";
        break;
      case "requires":
      case "triggers":
        if (v.startsWith("[") && v.endsWith("]")) {
          const items = v
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/["']/g, ""))
            .filter(Boolean);
          result[key] = items;
        }
        break;
    }
  }

  return result;
}

/**
 * Parse a skill file and extract metadata
 *
 * @param filePath - Path to the skill markdown file
 * @param agentName - Name of the agent that owns this skill
 * @returns SkillEntry or null if parsing fails
 */
export async function parseSkillFile(
  filePath: string,
  agentName: string
): Promise<SkillEntry | null> {
  try {
    const content = await readFile(filePath, "utf-8");

    // Determine skill name from path
    // Supports both flat files (skill.md) and directories (skill/SKILL.md)
    const fileName = basename(filePath, ".md");
    const dirName = basename(dirname(filePath));
    const derivedName = fileName === "SKILL" ? dirName : fileName;

    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch
      ? parseSimpleFrontmatter(frontmatterMatch[1])
      : {};

    // Get description from frontmatter or first paragraph
    let description = frontmatter.description;
    if (!description) {
      const bodyStart = frontmatterMatch ? frontmatterMatch[0].length : 0;
      const body = content.slice(bodyStart).trim();
      const firstPara = body.split("\n\n")[0];
      if (firstPara && !firstPara.startsWith("#")) {
        description = firstPara.slice(0, 200);
      }
    }

    return {
      name: frontmatter.name ?? derivedName,
      description: description ?? `Skill: ${derivedName}`,
      skillKey: `${agentName}:${frontmatter.name ?? derivedName}`,
      agentName,
      filePath,
      always: frontmatter.always,
      requires: frontmatter.requires,
      triggers: frontmatter.triggers,
    };
  } catch {
    return null;
  }
}

/**
 * Discover skills from a directory
 *
 * Supports two patterns:
 * 1. Flat files: skillsDir/skill-name.md
 * 2. Directories: skillsDir/skill-name/SKILL.md
 *
 * @param skillsDir - Directory containing skill files
 * @param agentName - Name of the agent that owns these skills
 * @returns Array of discovered SkillEntry objects
 */
export async function discoverSkills(
  skillsDir: string,
  agentName: string
): Promise<SkillEntry[]> {
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skills: SkillEntry[] = [];

    for (const entry of entries) {
      const entryPath = join(skillsDir, entry.name);

      if (entry.isFile() && entry.name.endsWith(".md")) {
        // Flat file pattern: skill-name.md
        const skill = await parseSkillFile(entryPath, agentName);
        if (skill) skills.push(skill);
      } else if (entry.isDirectory()) {
        // Directory pattern: skill-name/SKILL.md
        const skillFile = join(entryPath, "SKILL.md");
        try {
          const fileStat = await stat(skillFile);
          if (fileStat.isFile()) {
            const skill = await parseSkillFile(skillFile, agentName);
            if (skill) skills.push(skill);
          }
        } catch {
          // No SKILL.md in directory, check for index.md
          const indexFile = join(entryPath, "index.md");
          try {
            const indexStat = await stat(indexFile);
            if (indexStat.isFile()) {
              const skill = await parseSkillFile(indexFile, agentName);
              if (skill) skills.push(skill);
            }
          } catch {
            // No skill file found in directory
          }
        }
      }
    }

    return skills;
  } catch {
    return [];
  }
}

/**
 * Find a skill by name across multiple directories
 *
 * @param skillName - Name of the skill to find
 * @param skillsDirs - Map of agent name to skills directory
 * @param currentAgent - Optional agent to prioritize
 * @returns SkillEntry or undefined
 */
export async function findSkill(
  skillName: string,
  skillsDirs: Map<string, string>,
  currentAgent?: string
): Promise<SkillEntry | undefined> {
  // Handle cross-agent reference (e.g., "zee:invest-research")
  if (skillName.includes(":")) {
    const [agentName, name] = skillName.split(":");
    const dir = skillsDirs.get(agentName);
    if (!dir) return undefined;

    const skills = await discoverSkills(dir, agentName);
    return skills.find((s) => s.name === name);
  }

  // Check current agent first
  if (currentAgent) {
    const dir = skillsDirs.get(currentAgent);
    if (dir) {
      const skills = await discoverSkills(dir, currentAgent);
      const found = skills.find((s) => s.name === skillName);
      if (found) return found;
    }
  }

  // Search all agents
  for (const [agentName, dir] of skillsDirs) {
    const skills = await discoverSkills(dir, agentName);
    const found = skills.find((s) => s.name === skillName);
    if (found) return found;
  }

  return undefined;
}

/**
 * Get all skills across multiple agents
 *
 * @param skillsDirs - Map of agent name to skills directory
 * @returns Array of all discovered skills
 */
export async function getAllSkills(
  skillsDirs: Map<string, string>
): Promise<SkillEntry[]> {
  const results: SkillEntry[] = [];

  for (const [agentName, dir] of skillsDirs) {
    const skills = await discoverSkills(dir, agentName);
    results.push(...skills);
  }

  return results;
}
