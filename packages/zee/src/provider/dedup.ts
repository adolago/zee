import { Log } from "../util/log"

const log = Log.create({ service: "provider.dedup" })

/**
 * Parsed model info for deduplication.
 */
interface ParsedModel {
  family: string
  version: number
  dated: string | null
  isLatest: boolean
}

type ModelParser = (id: string) => ParsedModel | null

const DATE_PATTERN = /-(\d{8})$/

/**
 * Parse a Claude model ID into family/version for dedup.
 * Formats: claude-{type}-{major}-{minor}, claude-{major}-{minor}-{type}, claude-{major}-{type}
 */
function parseClaudeModel(id: string): ParsedModel | null {
  const isLatest = id.endsWith("-latest")
  const dateMatch = id.match(DATE_PATTERN)
  const dated = dateMatch ? dateMatch[1] : null
  const cleanID = id.replace(DATE_PATTERN, "").replace(/-latest$/, "")

  // New format: claude-{type}-{major}-{minor} (e.g., claude-opus-4-5)
  const newFormat = cleanID.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/)
  if (newFormat) {
    const [, type, major, minor] = newFormat
    return { family: `claude-${type}`, version: parseFloat(`${major}.${minor}`), dated, isLatest }
  }

  // Old format: claude-{major}-{minor}-{type} (e.g., claude-3-5-sonnet)
  const oldFormat = cleanID.match(/^claude-(\d+)-(\d+)-(opus|sonnet|haiku)$/)
  if (oldFormat) {
    const [, major, minor, type] = oldFormat
    return { family: `claude-${type}`, version: parseFloat(`${major}.${minor}`), dated, isLatest }
  }

  // Oldest format: claude-{major}-{type} (e.g., claude-3-opus)
  const oldestFormat = cleanID.match(/^claude-(\d+)-(opus|sonnet|haiku)$/)
  if (oldestFormat) {
    const [, major, type] = oldestFormat
    return { family: `claude-${type}`, version: parseFloat(major), dated, isLatest }
  }

  // New format without minor: claude-{type}-{major} (e.g., claude-opus-4)
  const newFormatNoMinor = cleanID.match(/^claude-(opus|sonnet|haiku)-(\d+)$/)
  if (newFormatNoMinor) {
    const [, type, major] = newFormatNoMinor
    return { family: `claude-${type}`, version: parseFloat(major), dated, isLatest }
  }

  return null
}

/**
 * Parse an OpenAI GPT model ID into family/version for dedup.
 * Formats: gpt-{major}(.{minor})?(-variant)?
 */
function parseOpenAIModel(id: string): ParsedModel | null {
  const isLatest = id.endsWith("-latest")
  const dateMatch = id.match(DATE_PATTERN)
  const dated = dateMatch ? dateMatch[1] : null
  const cleanID = id.replace(DATE_PATTERN, "").replace(/-latest$/, "")

  // gpt-{major}.{minor}-{variant} (e.g., gpt-5.1-codex, gpt-5.1-codex-mini)
  const withMinorVariant = cleanID.match(/^gpt-(\d+)\.(\d+)-(.+)$/)
  if (withMinorVariant) {
    const [, major, minor, variant] = withMinorVariant
    // Preserve GPT Pro as its own family so gpt-5.4 and gpt-5.4-pro can coexist.
    // Treat codex/codex-spark/etc. as variant families, but collapse generic suffixes
    // like "pro" into the base GPT family only when explicitly desired. Here we keep
    // pro separate because Zee intentionally exposes both ids.
    const family = variant === "pro" ? "gpt-pro" : `gpt-${variant}`
    return { family, version: parseFloat(`${major}.${minor}`), dated, isLatest }
  }

  // gpt-{major}-{variant} (e.g., gpt-5-codex, gpt-5-nano, gpt-5-pro)
  const withVariant = cleanID.match(/^gpt-(\d+)-(.+)$/)
  if (withVariant) {
    const [, major, variant] = withVariant
    return { family: `gpt-${variant}`, version: parseFloat(major), dated, isLatest }
  }

  // gpt-{major}.{minor} (e.g., gpt-5.1)
  const withMinor = cleanID.match(/^gpt-(\d+)\.(\d+)$/)
  if (withMinor) {
    const [, major, minor] = withMinor
    return { family: "gpt", version: parseFloat(`${major}.${minor}`), dated, isLatest }
  }

  // gpt-{major} (e.g., gpt-5)
  const base = cleanID.match(/^gpt-(\d+)$/)
  if (base) {
    const [, major] = base
    return { family: "gpt", version: parseFloat(major), dated, isLatest }
  }

  return null
}

/**
 * Parse a Google Gemini model ID into family/version for dedup.
 * Formats: gemini-{major}.{minor}-{type}, gemini-{type}-{major}.{minor}
 */
function parseGoogleModel(id: string): ParsedModel | null {
  const isLatest = id.endsWith("-latest")
  const dateMatch = id.match(DATE_PATTERN)
  const dated = dateMatch ? dateMatch[1] : null
  const cleanID = id
    .replace(DATE_PATTERN, "")
    .replace(/-latest$/, "")
    .replace(/-preview.*$/, "")

  // gemini-{major}.{minor}-{type} (e.g., gemini-2.5-flash, gemini-3-pro)
  const format1 = cleanID.match(/^gemini-(\d+)(?:\.(\d+))?-(.+)$/)
  if (format1) {
    const [, major, minor, type] = format1
    const version = minor ? parseFloat(`${major}.${minor}`) : parseFloat(major)
    return { family: `gemini-${type}`, version, dated, isLatest }
  }

  return null
}

/**
 * Parse an xAI Grok model ID into family/version for dedup.
 * Formats: grok-{major}(-variant)?
 */
function parseXAIModel(id: string): ParsedModel | null {
  const isLatest = id.endsWith("-latest")
  const dateMatch = id.match(DATE_PATTERN)
  const dated = dateMatch ? dateMatch[1] : null
  const cleanID = id.replace(DATE_PATTERN, "").replace(/-latest$/, "")

  // grok-{major}-{variant} (e.g., grok-3-fast, grok-3-mini, grok-3-mini-fast)
  const withVariant = cleanID.match(/^grok-(\d+)-(.+)$/)
  if (withVariant) {
    const [, major, variant] = withVariant
    return { family: `grok-${variant}`, version: parseFloat(major), dated, isLatest }
  }

  // grok-{major} (e.g., grok-3)
  const base = cleanID.match(/^grok-(\d+)$/)
  if (base) {
    const [, major] = base
    return { family: "grok", version: parseFloat(major), dated, isLatest }
  }

  return null
}

/**
 * Provider-specific model parsers.
 */
const PARSERS: Record<string, ModelParser> = {
  anthropic: parseClaudeModel,
  openai: parseOpenAIModel,
  google: parseGoogleModel,
  xai: parseXAIModel,
}

/**
 * Deduplicate models for a provider, keeping only the best version per family.
 * Priority: 1) -latest suffix, 2) highest version, 3) non-dated > dated, 4) most recent date.
 *
 * @returns Set of model IDs that should be removed.
 */
export function dedup(providerID: string, modelIDs: string[]): Set<string> {
  const parser = PARSERS[providerID]
  if (!parser) return new Set()

  const families: Record<string, { id: string; version: number; dated: string | null; isLatest: boolean }[]> = {}

  for (const modelID of modelIDs) {
    const parsed = parser(modelID)
    if (parsed) {
      if (!families[parsed.family]) families[parsed.family] = []
      families[parsed.family].push({
        id: modelID,
        version: parsed.version,
        dated: parsed.dated,
        isLatest: parsed.isLatest,
      })
    }
  }

  const removed = new Set<string>()

  for (const [family, versions] of Object.entries(families)) {
    if (versions.length <= 1) continue

    const sorted = [...versions].sort((a, b) => {
      if (a.version !== b.version) return b.version - a.version
      if (a.isLatest !== b.isLatest) return a.isLatest ? -1 : 1
      if ((a.dated === null) !== (b.dated === null)) return a.dated === null ? -1 : 1
      if (a.dated && b.dated) return b.dated.localeCompare(a.dated)
      return 0
    })

    log.debug("dedup family", {
      providerID,
      family,
      kept: sorted[0].id,
      removed: sorted.slice(1).map((s) => s.id),
    })

    for (let i = 1; i < sorted.length; i++) {
      removed.add(sorted[i].id)
    }
  }

  return removed
}

/**
 * Check if a provider has a dedup parser registered.
 */
export function hasDedupParser(providerID: string): boolean {
  return providerID in PARSERS
}
