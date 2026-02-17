import path from "node:path"
import { existsSync } from "node:fs"

const repoRoot = path.resolve(import.meta.dir, "../../..")
const skillsRoot = path.join(repoRoot, ".agents", "skills")
const aliasesPath = path.join(repoRoot, "packages", "zee", "skills", "aliases.yaml")
const registryPath = path.join(repoRoot, "packages", "zee", "skills", "registry.yaml")

const skillFiles = await Array.fromAsync(
  new Bun.Glob("**/SKILL.md").scan({
    cwd: skillsRoot,
    absolute: true,
    onlyFiles: true,
    followSymlinks: true,
    dot: true,
  }),
)

const docGlobs = [
  "**/*.md",
  "**/*.txt",
  "**/*.json",
  "**/*.yaml",
  "**/*.yml",
  "**/*.py",
  "**/*.sh",
  "**/*.ps1",
]
const docFilesSet = new Set<string>()
for (const pattern of docGlobs) {
  const matches = await Array.fromAsync(
    new Bun.Glob(pattern).scan({
      cwd: skillsRoot,
      absolute: true,
      onlyFiles: true,
      followSymlinks: true,
      dot: true,
    }),
  )
  for (const file of matches) docFilesSet.add(file)
}
const docFiles = [...docFilesSet]

const errors: string[] = []

if (!existsSync(aliasesPath)) {
  errors.push(`Missing aliases registry: ${aliasesPath}`)
}
if (!existsSync(registryPath)) {
  errors.push(`Missing canonical skill registry: ${registryPath}`)
}

for (const file of skillFiles) {
  const rel = path.relative(repoRoot, file)
  const normalized = rel.replace(/\\/g, "/")
  if (!normalized.includes(".agents/skills/@zee/")) {
    errors.push(`Non-canonical skill location: ${normalized}`)
    continue
  }

  const content = await Bun.file(file).text()
  if (/^source:\s*(clawhub|codex)\s*$/m.test(content)) {
    errors.push(`Legacy source field in ${normalized}`)
  }
}

const legacyDocPatterns: Array<{ label: string; regex: RegExp }> = [
  { label: "clawhub", regex: /\bclawhub\b/i },
  { label: "clawdhub", regex: /\bclawdhub\b/i },
  { label: "@codex/", regex: /@codex\//i },
  { label: "codex", regex: /\bcodex\b/i },
]

for (const file of docFiles) {
  const rel = path.relative(repoRoot, file)
  const normalized = rel.replace(/\\/g, "/")
  if (!normalized.includes(".agents/skills/@zee/")) continue

  const content = await Bun.file(file).text()
  for (const pattern of legacyDocPatterns) {
    if (pattern.regex.test(content)) {
      errors.push(`Legacy term "${pattern.label}" in ${normalized}`)
      break
    }
  }
}

if (errors.length > 0) {
  console.error("First-party skill verification failed:")
  for (const error of errors) {
    console.error(` - ${error}`)
  }
  process.exit(1)
}

console.log(
  `First-party skill verification passed (${skillFiles.length} skill files, ${docFiles.length} docs scanned).`,
)
