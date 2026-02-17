import path from "node:path"
import fs from "node:fs/promises"
import z from "zod"

export const ResourceKindSchema = z.enum(["plugins", "skills", "prompts", "themes", "extensions"])
export type ResourceKind = z.infer<typeof ResourceKindSchema>

export const ZeeManifestSchema = z
  .object({
    plugins: z.array(z.string()).default([]),
    skills: z.array(z.string()).default([]),
    prompts: z.array(z.string()).default([]),
    themes: z.array(z.string()).default([]),
    extensions: z.array(z.string()).default([]),
  })
  .default({
    plugins: [],
    skills: [],
    prompts: [],
    themes: [],
    extensions: [],
  })

export type ZeeManifest = z.infer<typeof ZeeManifestSchema>

export const PackageJsonSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  zee: ZeeManifestSchema.optional(),
})

export type PackageMetadata = {
  name: string
  version?: string
  manifest: ZeeManifest
  packageDir: string
}

export async function loadPackageMetadata(packageDir: string): Promise<PackageMetadata> {
  const pkgPath = path.join(packageDir, "package.json")
  const pkgText = await fs.readFile(pkgPath, "utf-8")
  const raw = JSON.parse(pkgText)
  const parsed = PackageJsonSchema.parse(raw)
  return {
    name: parsed.name,
    version: parsed.version,
    manifest: parsed.zee ?? ZeeManifestSchema.parse({}),
    packageDir,
  }
}

export function validateManifestPaths(meta: PackageMetadata): string[] {
  const errors: string[] = []
  for (const kind of ResourceKindSchema.options) {
    for (const rel of meta.manifest[kind]) {
      const resolved = path.resolve(meta.packageDir, rel)
      const normalized = path.normalize(resolved)
      if (!normalized.startsWith(path.normalize(meta.packageDir + path.sep))) {
        errors.push(`${kind}: path escapes package root: ${rel}`)
      }
    }
  }
  return errors
}
