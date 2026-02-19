import path from "path"
import { parse as parseYaml } from "yaml"

type RegistryRecord = {
  canonical_name: string
  current_path: string
  status?: string
}

type RegistryFile = {
  skills?: RegistryRecord[]
}

type AliasFile = {
  aliases?: Record<string, string>
}

async function readYaml<T>(filePath: string): Promise<T | undefined> {
  const raw = await Bun.file(filePath)
    .text()
    .catch(() => "")
  if (!raw.trim()) return
  return parseYaml(raw) as T
}

async function main(): Promise<void> {
  const { Log } = await import("../src/util/log")
  await Log.init({ print: true, level: "ERROR" })

  const [{ Skill }, { Instance }] = await Promise.all([import("../src/skill"), import("../src/project/instance")])

  const repoRoot = path.resolve(import.meta.dir, "../../..")
  const registryPath = path.join(repoRoot, "packages", "zee", "skills", "registry.yaml")
  const aliasesPath = path.join(repoRoot, "packages", "zee", "skills", "aliases.yaml")

  const [registryRaw, aliasesRaw] = await Promise.all([
    readYaml<RegistryFile>(registryPath),
    readYaml<AliasFile>(aliasesPath),
  ])

  const registrySkills = (registryRaw?.skills ?? []).map((skill) => skill.canonical_name)
  const aliases = aliasesRaw?.aliases ?? {}

  const runtimeAudit = await Instance.provide({
    directory: process.cwd(),
    fn: async () => Skill.audit(),
  })

  const runtimeSkills = runtimeAudit.loaded.map((skill) => skill.name)
  const runtimeSet = new Set(runtimeSkills)
  const registrySet = new Set(registrySkills)

  const missingInRuntime = registrySkills.filter((name) => !runtimeSet.has(name))
  const missingInRegistry = runtimeSkills.filter((name) => !registrySet.has(name))
  const unresolvedAliasTargets = Object.entries(aliases)
    .filter(([, target]) => !registrySet.has(target))
    .map(([alias, target]) => ({ alias, target }))

  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      registryCount: registrySkills.length,
      runtimeCount: runtimeSkills.length,
      aliasCount: Object.keys(aliases).length,
      conflicts: runtimeAudit.conflicts.length,
      exclusions: runtimeAudit.excluded.length,
      missingEnv: runtimeAudit.missingEnv.length,
    },
    drift: {
      missingInRuntime,
      missingInRegistry,
      unresolvedAliasTargets,
    },
    runtime: runtimeAudit,
    severity: {
      errors: [
        ...(missingInRuntime.length > 0 ? [`${missingInRuntime.length} skills missing in runtime`] : []),
        ...(missingInRegistry.length > 0 ? [`${missingInRegistry.length} runtime skills missing in registry`] : []),
        ...(unresolvedAliasTargets.length > 0
          ? [`${unresolvedAliasTargets.length} aliases with unresolved target`]
          : []),
      ],
      warnings: [
        ...(runtimeAudit.conflicts.length > 0 ? [`${runtimeAudit.conflicts.length} skill conflicts`] : []),
        ...(runtimeAudit.excluded.length > 0 ? [`${runtimeAudit.excluded.length} excluded skills`] : []),
        ...(runtimeAudit.missingEnv.length > 0 ? [`${runtimeAudit.missingEnv.length} skills with missing env`] : []),
      ],
    },
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
