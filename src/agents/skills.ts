import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Skill } from "../config/sessions.js";
export type { Skill };

// Local implementation of formatSkillsForPrompt (replaces pi-coding-agent)
function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((skill) => {
    const desc = skill.description ? `: ${skill.description}` : "";
    const filePath = skill.filePath ? ` (${skill.filePath})` : "";
    return `- ${skill.name}${desc}${filePath}`;
  });
  return `Available skills:\n${lines.join("\n")}`;
}

// Local implementation of loadSkillsFromDir (replaces pi-coding-agent)
function loadSkillsFromDir(
  params: { dir: string; source?: string } | string,
): Skill[] {
  const dir = typeof params === "string" ? params : params.dir;
  const source = typeof params === "object" ? params.source : undefined;
  if (!fs.existsSync(dir)) return [];
  const skills: Skill[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillDir = path.join(dir, entry.name);
        const skillPath = path.join(skillDir, "skill.json");
        // Also check for SKILL.md (uppercase) and skill.md (lowercase)
        const skillMdUpperPath = path.join(skillDir, "SKILL.md");
        const skillMdLowerPath = path.join(skillDir, "skill.md");
        const skillMdPath = fs.existsSync(skillMdUpperPath)
          ? skillMdUpperPath
          : skillMdLowerPath;
        if (fs.existsSync(skillPath)) {
          try {
            const content = fs.readFileSync(skillPath, "utf-8");
            const skill = JSON.parse(content) as Skill;
            if (skill.name) {
              skill.filePath = skillPath;
              if (source) skill.source = source;
              skills.push(skill);
            }
          } catch {
            // Skip invalid skill files
          }
        } else if (fs.existsSync(skillMdPath)) {
          // Handle SKILL.md files - parse YAML frontmatter
          try {
            const content = fs.readFileSync(skillMdPath, "utf-8");
            const skill = parseSkillMd(content, entry.name, skillMdPath);
            if (skill) {
              if (source) skill.source = source;
              skills.push(skill);
            }
          } catch {
            // Skip invalid skill files
          }
        }
      }
    }
  } catch {
    // Return empty array on errors
  }
  return skills;
}

// Parse SKILL.md with YAML frontmatter
function parseSkillMd(
  content: string,
  fallbackName: string,
  filePath: string,
): Skill | null {
  // Check for YAML frontmatter (between --- markers)
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    // Simple YAML parsing for name, description, metadata
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    const metadataMatch = frontmatter.match(/^metadata:\s*(.+)$/m);

    const name = nameMatch?.[1]?.trim() ?? fallbackName;
    const description = descMatch?.[1]?.trim();
    const skill: Skill = { name, filePath };
    if (description) skill.description = description;

    // Parse metadata JSON if present
    if (metadataMatch?.[1]) {
      try {
        const metadata = JSON.parse(metadataMatch[1].trim());
        if (metadata.zee) {
          // Store zee metadata for later processing
          (skill as unknown as { _zeeMetadata: unknown })._zeeMetadata =
            metadata.zee;
        }
      } catch {
        // Ignore invalid metadata JSON
      }
    }
    return skill;
  }

  // Fallback: use directory name and extract description from heading
  const skill: Skill = { name: fallbackName, filePath };
  const headingMatch = content.match(/^#\s*(.+?)$/m);
  if (headingMatch) {
    skill.description = headingMatch[1].trim();
  }
  return skill;
}

import type { SkillConfig, ZeeConfig } from "../config/config.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";

export type SkillInstallSpec = {
  id?: string;
  kind: "brew" | "node" | "go" | "uv";
  label?: string;
  bins?: string[];
  formula?: string;
  package?: string;
  module?: string;
};

export type ZeeSkillMetadata = {
  always?: boolean;
  skillKey?: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  os?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  install?: SkillInstallSpec[];
};

export type SkillsInstallPreferences = {
  preferBrew: boolean;
  nodeManager: "npm" | "pnpm" | "yarn" | "bun";
};

type ParsedSkillFrontmatter = Record<string, string>;

export type SkillEntry = {
  skill: Skill;
  frontmatter: ParsedSkillFrontmatter;
  zee?: ZeeSkillMetadata;
};

export type SkillSnapshot = {
  prompt: string;
  skills: Array<{ name: string; primaryEnv?: string }>;
  resolvedSkills?: Skill[];
};

function resolveBundledSkillsDir(): string | undefined {
  const override = process.env.ZEE_BUNDLED_SKILLS_DIR?.trim();
  if (override) return override;

  // bun --compile: ship a sibling `skills/` next to the executable.
  try {
    const execDir = path.dirname(process.execPath);
    const sibling = path.join(execDir, "skills");
    if (fs.existsSync(sibling)) return sibling;
  } catch {
    // ignore
  }

  // npm/dev: resolve `<packageRoot>/skills` relative to this module.
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(moduleDir, "..", "..");
    const candidate = path.join(root, "skills");
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    // ignore
  }

  return undefined;
}
function getFrontmatterValue(
  frontmatter: ParsedSkillFrontmatter,
  key: string,
): string | undefined {
  const raw = frontmatter[key];
  return typeof raw === "string" ? raw : undefined;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontmatter(content: string): ParsedSkillFrontmatter {
  const frontmatter: ParsedSkillFrontmatter = {};
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return frontmatter;
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return frontmatter;
  const block = normalized.slice(4, endIndex);
  for (const line of block.split("\n")) {
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = stripQuotes(match[2].trim());
    if (!key || !value) continue;
    frontmatter[key] = value;
  }
  return frontmatter;
}

function normalizeStringList(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function parseInstallSpec(input: unknown): SkillInstallSpec | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const kindRaw =
    typeof raw.kind === "string"
      ? raw.kind
      : typeof raw.type === "string"
        ? raw.type
        : "";
  const kind = kindRaw.trim().toLowerCase();
  if (kind !== "brew" && kind !== "node" && kind !== "go" && kind !== "uv") {
    return undefined;
  }

  const spec: SkillInstallSpec = {
    kind: kind as SkillInstallSpec["kind"],
  };

  if (typeof raw.id === "string") spec.id = raw.id;
  if (typeof raw.label === "string") spec.label = raw.label;
  const bins = normalizeStringList(raw.bins);
  if (bins.length > 0) spec.bins = bins;
  if (typeof raw.formula === "string") spec.formula = raw.formula;
  if (typeof raw.package === "string") spec.package = raw.package;
  if (typeof raw.module === "string") spec.module = raw.module;

  return spec;
}

function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

const DEFAULT_CONFIG_VALUES: Record<string, boolean> = {
  "browser.enabled": true,
};

export function resolveSkillsInstallPreferences(
  config?: ZeeConfig,
): SkillsInstallPreferences {
  const raw = config?.skills?.install;
  const preferBrew = raw?.preferBrew ?? true;
  const managerRaw =
    typeof raw?.nodeManager === "string" ? raw.nodeManager.trim() : "";
  const manager = managerRaw.toLowerCase();
  const nodeManager =
    manager === "pnpm" ||
    manager === "yarn" ||
    manager === "bun" ||
    manager === "npm"
      ? (manager as SkillsInstallPreferences["nodeManager"])
      : "npm";
  return { preferBrew, nodeManager };
}

export function resolveRuntimePlatform(): string {
  return process.platform;
}

export function resolveConfigPath(
  config: ZeeConfig | undefined,
  pathStr: string,
) {
  const parts = pathStr.split(".").filter(Boolean);
  let current: unknown = config;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function isConfigPathTruthy(
  config: ZeeConfig | undefined,
  pathStr: string,
): boolean {
  const value = resolveConfigPath(config, pathStr);
  if (value === undefined && pathStr in DEFAULT_CONFIG_VALUES) {
    return DEFAULT_CONFIG_VALUES[pathStr] === true;
  }
  return isTruthy(value);
}

export function resolveSkillConfig(
  config: ZeeConfig | undefined,
  skillKey: string,
): SkillConfig | undefined {
  const skills = config?.skills?.entries;
  if (!skills || typeof skills !== "object") return undefined;
  const entry = (skills as Record<string, SkillConfig | undefined>)[skillKey];
  if (!entry || typeof entry !== "object") return undefined;
  return entry;
}

function normalizeAllowlist(input: unknown): string[] | undefined {
  if (!input) return undefined;
  if (!Array.isArray(input)) return undefined;
  const normalized = input.map((entry) => String(entry).trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function isBundledSkill(entry: SkillEntry): boolean {
  return entry.skill.source === "zee-bundled";
}

export function isBundledSkillAllowed(
  entry: SkillEntry,
  allowlist?: string[],
): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  if (!isBundledSkill(entry)) return true;
  const key = resolveSkillKey(entry.skill, entry);
  return allowlist.includes(key) || allowlist.includes(entry.skill.name);
}

export function hasBinary(bin: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  const parts = pathEnv.split(path.delimiter).filter(Boolean);
  for (const part of parts) {
    const candidate = path.join(part, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      // keep scanning
    }
  }
  return false;
}

function resolveZeeMetadata(
  frontmatter: ParsedSkillFrontmatter,
): ZeeSkillMetadata | undefined {
  const raw = getFrontmatterValue(frontmatter, "metadata");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { zee?: unknown };
    if (!parsed || typeof parsed !== "object") return undefined;
    const zee = (parsed as { zee?: unknown }).zee;
    if (!zee || typeof zee !== "object") return undefined;
    const zeeObj = zee as Record<string, unknown>;
    const requiresRaw =
      typeof zeeObj.requires === "object" && zeeObj.requires !== null
        ? (zeeObj.requires as Record<string, unknown>)
        : undefined;
    const installRaw = Array.isArray(zeeObj.install)
      ? (zeeObj.install as unknown[])
      : [];
    const install = installRaw
      .map((entry) => parseInstallSpec(entry))
      .filter((entry): entry is SkillInstallSpec => Boolean(entry));
    const osRaw = normalizeStringList(zeeObj.os);
    return {
      always: typeof zeeObj.always === "boolean" ? zeeObj.always : undefined,
      emoji: typeof zeeObj.emoji === "string" ? zeeObj.emoji : undefined,
      homepage:
        typeof zeeObj.homepage === "string" ? zeeObj.homepage : undefined,
      skillKey:
        typeof zeeObj.skillKey === "string" ? zeeObj.skillKey : undefined,
      primaryEnv:
        typeof zeeObj.primaryEnv === "string" ? zeeObj.primaryEnv : undefined,
      os: osRaw.length > 0 ? osRaw : undefined,
      requires: requiresRaw
        ? {
            bins: normalizeStringList(requiresRaw.bins),
            anyBins: normalizeStringList(requiresRaw.anyBins),
            env: normalizeStringList(requiresRaw.env),
            config: normalizeStringList(requiresRaw.config),
          }
        : undefined,
      install: install.length > 0 ? install : undefined,
    };
  } catch {
    return undefined;
  }
}

function resolveSkillKey(skill: Skill, entry?: SkillEntry): string {
  return entry?.zee?.skillKey ?? skill.name;
}

function shouldIncludeSkill(params: {
  entry: SkillEntry;
  config?: ZeeConfig;
}): boolean {
  const { entry, config } = params;
  const skillKey = resolveSkillKey(entry.skill, entry);
  const skillConfig = resolveSkillConfig(config, skillKey);
  const allowBundled = normalizeAllowlist(config?.skills?.allowBundled);
  const osList = entry.zee?.os ?? [];

  if (skillConfig?.enabled === false) return false;
  if (!isBundledSkillAllowed(entry, allowBundled)) return false;
  if (osList.length > 0 && !osList.includes(resolveRuntimePlatform())) {
    return false;
  }
  if (entry.zee?.always === true) {
    return true;
  }

  const requiredBins = entry.zee?.requires?.bins ?? [];
  if (requiredBins.length > 0) {
    for (const bin of requiredBins) {
      if (!hasBinary(bin)) return false;
    }
  }
  const requiredAnyBins = entry.zee?.requires?.anyBins ?? [];
  if (requiredAnyBins.length > 0) {
    const anyFound = requiredAnyBins.some((bin) => hasBinary(bin));
    if (!anyFound) return false;
  }

  const requiredEnv = entry.zee?.requires?.env ?? [];
  if (requiredEnv.length > 0) {
    for (const envName of requiredEnv) {
      if (process.env[envName]) continue;
      if (skillConfig?.env?.[envName]) continue;
      if (skillConfig?.apiKey && entry.zee?.primaryEnv === envName) {
        continue;
      }
      return false;
    }
  }

  const requiredConfig = entry.zee?.requires?.config ?? [];
  if (requiredConfig.length > 0) {
    for (const configPath of requiredConfig) {
      if (!isConfigPathTruthy(config, configPath)) return false;
    }
  }

  return true;
}

function filterSkillEntries(
  entries: SkillEntry[],
  config?: ZeeConfig,
  skillFilter?: string[],
): SkillEntry[] {
  let filtered = entries.filter((entry) =>
    shouldIncludeSkill({ entry, config }),
  );
  // If skillFilter is provided, only include skills in the filter list.
  if (skillFilter !== undefined) {
    const normalized = skillFilter
      .map((entry) => String(entry).trim())
      .filter(Boolean);
    const label = normalized.length > 0 ? normalized.join(", ") : "(none)";
    console.log(`[skills] Applying skill filter: ${label}`);
    filtered =
      normalized.length > 0
        ? filtered.filter((entry) => normalized.includes(entry.skill.name))
        : [];
    console.log(
      `[skills] After filter: ${filtered.map((entry) => entry.skill.name).join(", ")}`,
    );
  }
  return filtered;
}

export function applySkillEnvOverrides(params: {
  skills: SkillEntry[];
  config?: ZeeConfig;
}) {
  const { skills, config } = params;
  const updates: Array<{ key: string; prev: string | undefined }> = [];

  for (const entry of skills) {
    const skillKey = resolveSkillKey(entry.skill, entry);
    const skillConfig = resolveSkillConfig(config, skillKey);
    if (!skillConfig) continue;

    if (skillConfig.env) {
      for (const [envKey, envValue] of Object.entries(skillConfig.env)) {
        if (!envValue || process.env[envKey]) continue;
        updates.push({ key: envKey, prev: process.env[envKey] });
        process.env[envKey] = envValue;
      }
    }

    const primaryEnv = entry.zee?.primaryEnv;
    if (primaryEnv && skillConfig.apiKey && !process.env[primaryEnv]) {
      updates.push({ key: primaryEnv, prev: process.env[primaryEnv] });
      process.env[primaryEnv] = skillConfig.apiKey;
    }
  }

  return () => {
    for (const update of updates) {
      if (update.prev === undefined) delete process.env[update.key];
      else process.env[update.key] = update.prev;
    }
  };
}

export function applySkillEnvOverridesFromSnapshot(params: {
  snapshot?: SkillSnapshot;
  config?: ZeeConfig;
}) {
  const { snapshot, config } = params;
  if (!snapshot) return () => {};
  const updates: Array<{ key: string; prev: string | undefined }> = [];

  for (const skill of snapshot.skills) {
    const skillConfig = resolveSkillConfig(config, skill.name);
    if (!skillConfig) continue;

    if (skillConfig.env) {
      for (const [envKey, envValue] of Object.entries(skillConfig.env)) {
        if (!envValue || process.env[envKey]) continue;
        updates.push({ key: envKey, prev: process.env[envKey] });
        process.env[envKey] = envValue;
      }
    }

    if (
      skill.primaryEnv &&
      skillConfig.apiKey &&
      !process.env[skill.primaryEnv]
    ) {
      updates.push({
        key: skill.primaryEnv,
        prev: process.env[skill.primaryEnv],
      });
      process.env[skill.primaryEnv] = skillConfig.apiKey;
    }
  }

  return () => {
    for (const update of updates) {
      if (update.prev === undefined) delete process.env[update.key];
      else process.env[update.key] = update.prev;
    }
  };
}

function loadSkillEntries(
  workspaceDir: string,
  opts?: {
    config?: ZeeConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
  },
): SkillEntry[] {
  const loadSkills = (params: { dir: string; source: string }): Skill[] => {
    const loaded = loadSkillsFromDir(params);
    if (Array.isArray(loaded)) return loaded;
    if (
      loaded &&
      typeof loaded === "object" &&
      "skills" in loaded &&
      Array.isArray((loaded as { skills?: unknown }).skills)
    ) {
      return (loaded as { skills: Skill[] }).skills;
    }
    return [];
  };

  const managedSkillsDir =
    opts?.managedSkillsDir ?? path.join(CONFIG_DIR, "skills");
  const workspaceSkillsDir = path.join(workspaceDir, "skills");
  const bundledSkillsDir = opts?.bundledSkillsDir ?? resolveBundledSkillsDir();
  const extraDirsRaw = opts?.config?.skills?.load?.extraDirs ?? [];
  const extraDirs = extraDirsRaw
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter(Boolean);

  const bundledSkills = bundledSkillsDir
    ? loadSkills({
        dir: bundledSkillsDir,
        source: "zee-bundled",
      })
    : [];
  const extraSkills = extraDirs.flatMap((dir) => {
    const resolved = resolveUserPath(dir);
    return loadSkills({
      dir: resolved,
      source: "zee-extra",
    });
  });
  const managedSkills = loadSkills({
    dir: managedSkillsDir,
    source: "zee-managed",
  });
  const workspaceSkills = loadSkills({
    dir: workspaceSkillsDir,
    source: "zee-workspace",
  });

  const merged = new Map<string, Skill>();
  // Precedence: extra < bundled < managed < workspace
  for (const skill of extraSkills) merged.set(skill.name, skill);
  for (const skill of bundledSkills) merged.set(skill.name, skill);
  for (const skill of managedSkills) merged.set(skill.name, skill);
  for (const skill of workspaceSkills) merged.set(skill.name, skill);

  const skillEntries: SkillEntry[] = Array.from(merged.values()).map(
    (skill) => {
      let frontmatter: ParsedSkillFrontmatter = {};
      if (skill.filePath) {
        try {
          const raw = fs.readFileSync(skill.filePath, "utf-8");
          frontmatter = parseFrontmatter(raw);
        } catch {
          // ignore malformed skills
        }
      }
      return {
        skill,
        frontmatter,
        zee: resolveZeeMetadata(frontmatter),
      };
    },
  );
  return skillEntries;
}

export function buildWorkspaceSkillSnapshot(
  workspaceDir: string,
  opts?: {
    config?: ZeeConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
    entries?: SkillEntry[];
    /** If provided, only include skills with these names */
    skillFilter?: string[];
  },
): SkillSnapshot {
  const skillEntries = opts?.entries ?? loadSkillEntries(workspaceDir, opts);
  const eligible = filterSkillEntries(
    skillEntries,
    opts?.config,
    opts?.skillFilter,
  );
  const resolvedSkills = eligible.map((entry) => entry.skill);
  return {
    prompt: formatSkillsForPrompt(resolvedSkills),
    skills: eligible.map((entry) => ({
      name: entry.skill.name,
      primaryEnv: entry.zee?.primaryEnv,
    })),
    resolvedSkills,
  };
}

export function buildWorkspaceSkillsPrompt(
  workspaceDir: string,
  opts?: {
    config?: ZeeConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
    entries?: SkillEntry[];
    /** If provided, only include skills with these names */
    skillFilter?: string[];
  },
): string {
  const skillEntries = opts?.entries ?? loadSkillEntries(workspaceDir, opts);
  const eligible = filterSkillEntries(
    skillEntries,
    opts?.config,
    opts?.skillFilter,
  );
  return formatSkillsForPrompt(eligible.map((entry) => entry.skill));
}

export function loadWorkspaceSkillEntries(
  workspaceDir: string,
  opts?: {
    config?: ZeeConfig;
    managedSkillsDir?: string;
    bundledSkillsDir?: string;
  },
): SkillEntry[] {
  return loadSkillEntries(workspaceDir, opts);
}

export function filterWorkspaceSkillEntries(
  entries: SkillEntry[],
  config?: ZeeConfig,
): SkillEntry[] {
  return filterSkillEntries(entries, config);
}
export function resolveBundledAllowlist(
  config?: ZeeConfig,
): string[] | undefined {
  return normalizeAllowlist(config?.skills?.allowBundled);
}
