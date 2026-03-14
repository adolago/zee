import { NamedError } from "@zee/util/error"
import matter from "gray-matter"
import { z } from "zod"

export namespace ConfigMarkdown {
  export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g
  export const SHELL_REGEX = /!`([^`]+)`/g
  const ENV_REGEX = /\{env:([^}]+)\}/g

  export function files(template: string) {
    return Array.from(template.matchAll(FILE_REGEX))
  }

  export function shell(template: string) {
    return Array.from(template.matchAll(SHELL_REGEX))
  }

  function interpolateData(value: unknown): unknown {
    if (typeof value === "string") {
      return value.replace(ENV_REGEX, (_match, variableName: string) => process.env[variableName] ?? "")
    }
    if (Array.isArray(value)) {
      return value.map(interpolateData)
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, interpolateData(nested)]))
    }
    return value
  }

  // Sanitize frontmatter values that contain colon-space patterns which YAML
  // silently misparses as separate mapping keys, truncating the value.
  export function fallbackSanitization(content: string): string {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return content

    const frontmatter = match[1]
    const lines = frontmatter.split("\n")
    const result: string[] = []

    for (const line of lines) {
      // skip comments and empty lines
      if (line.trim().startsWith("#") || line.trim() === "") {
        result.push(line)
        continue
      }

      // skip lines that are continuations (indented)
      if (line.match(/^\s+/)) {
        result.push(line)
        continue
      }

      // match key: value pattern
      const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
      if (!kvMatch) {
        result.push(line)
        continue
      }

      const key = kvMatch[1]
      const value = kvMatch[2].trim()

      // skip if value is empty, already quoted, or uses block scalar
      if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) {
        result.push(line)
        continue
      }

      // if value contains a colon, convert to block scalar
      if (value.includes(":")) {
        result.push(`${key}: |-`)
        result.push(`  ${value}`)
        continue
      }

      result.push(line)
    }

    const processed = result.join("\n")
    return content.replace(frontmatter, () => processed)
  }

  export async function parse(filePath: string) {
    const template = await Bun.file(filePath).text()

    // Always sanitize: YAML silently truncates unquoted values containing
    // colon-space patterns instead of throwing, so the fallback path never
    // fires for the most common misparse case.
    const sanitized = fallbackSanitization(template)
    try {
      const parsed = matter(sanitized)
      parsed.data = interpolateData(parsed.data) as typeof parsed.data
      return parsed
    } catch (err) {
      throw new FrontmatterError(
        {
          path: filePath,
          message: `${filePath}: Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        },
        { cause: err },
      )
    }
  }

  export const FrontmatterError = NamedError.create(
    "ConfigFrontmatterError",
    z.object({
      path: z.string(),
      message: z.string(),
    }),
  )
}
